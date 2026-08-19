package config

import "testing"

func TestDefaultIsValid(t *testing.T) {
	if err := Default().Validate(); err != nil {
		t.Fatalf("the default configuration must validate, got %v", err)
	}
}

func TestValidateReportsEveryProblem(t *testing.T) {
	c := Default()
	c.Server.Addr = ""
	c.Index.Zoom = 99
	c.Cache.Shards = 3
	c.Store.CompactRatio = 2
	err := c.Validate()
	if err == nil {
		t.Fatal("expected validation to fail")
	}
	es, ok := err.(Errors)
	if !ok {
		t.Fatalf("expected Errors, got %T", err)
	}
	if len(es) != 4 {
		t.Fatalf("expected four problems, got %d: %v", len(es), es)
	}
}

func TestDefaultSectionsMatchDefault(t *testing.T) {
	d := Default()
	if DefaultServer() != d.Server {
		t.Error("DefaultServer disagrees with Default")
	}
	if DefaultIndex() != d.Index {
		t.Error("DefaultIndex disagrees with Default")
	}
	if DefaultCache() != d.Cache {
		t.Error("DefaultCache disagrees with Default")
	}
}
