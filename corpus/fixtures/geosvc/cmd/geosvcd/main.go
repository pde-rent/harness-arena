// Command geosvcd runs one geosvc process: it builds the configuration,
// validates it, wires the service and the HTTP router together, and serves
// until it is interrupted.
//
// The daemon has no configuration file. Flags cover the handful of settings an
// operator changes per deployment; everything else comes from the defaults in
// package config.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"geosvc/config"
	"geosvc/httpapi"
	"geosvc/metrics"
	"geosvc/service"
)

// shutdownGrace is how long in-flight requests are given to finish once a
// termination signal has arrived.
const shutdownGrace = 10 * time.Second

func main() {
	if err := run(os.Args[1:]); err != nil {
		log.Printf("geosvcd: %v", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	cfg := config.Default()

	fs := flag.NewFlagSet("geosvcd", flag.ContinueOnError)
	fs.StringVar(&cfg.Server.Addr, "addr", cfg.Server.Addr, "listen address in host:port form")
	fs.StringVar(&cfg.Server.BasePath, "base-path", cfg.Server.BasePath, "path prefix for every route")
	fs.StringVar(&cfg.Index.Kind, "index", cfg.Index.Kind, `index implementation: "rtree" or "grid"`)
	fs.IntVar(&cfg.Index.Zoom, "zoom", cfg.Index.Zoom, "tile zoom the region is indexed at")
	fs.StringVar(&cfg.Cache.Kind, "cache", cfg.Cache.Kind, `feature cache implementation: "lru" or "segmented"`)
	fs.IntVar(&cfg.Cache.Entries, "cache-entries", cfg.Cache.Entries, "feature cache capacity in entries")
	fs.Int64Var(&cfg.Cache.TileBudgetBytes, "tile-budget", cfg.Cache.TileBudgetBytes, "tile cache budget in bytes")
	fs.StringVar(&cfg.Store.Path, "store-path", cfg.Store.Path, "append log directory; empty means memory only")
	fs.BoolVar(&cfg.Metrics.Enabled, "metrics", cfg.Metrics.Enabled, "collect metrics")
	if err := fs.Parse(args); err != nil {
		return err
	}

	if err := cfg.Validate(); err != nil {
		return fmt.Errorf("invalid configuration: %w", err)
	}

	reg := metrics.NewRegistry(cfg.Metrics)
	svc, err := service.New(cfg, reg)
	if err != nil {
		return err
	}
	defer func() {
		if cerr := svc.Close(); cerr != nil {
			log.Printf("geosvcd: closing service: %v", cerr)
		}
	}()

	srv := &http.Server{
		Addr:         cfg.Server.Addr,
		Handler:      httpapi.NewRouter(svc, cfg, reg),
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errc := make(chan error, 1)
	go func() {
		log.Printf("geosvcd: listening on %s%s, index=%s cache=%s",
			cfg.Server.Addr, cfg.Server.BasePath, cfg.Index.Kind, cfg.Cache.Kind)
		errc <- srv.ListenAndServe()
	}()

	select {
	case err := <-errc:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		log.Print("geosvcd: shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownGrace)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			return fmt.Errorf("shutdown: %w", err)
		}
		return nil
	}
}
