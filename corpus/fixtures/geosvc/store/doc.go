// Package store holds features and the append log that makes them durable.
//
// The store is the system of record. The index packages hold only enough
// information to answer "which feature ids match this box"; the full feature
// bodies always come back from here. That split is why the sizing model counts
// index-resident bytes separately from stored bytes.
package store
