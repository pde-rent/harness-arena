// Package config holds the service's configuration structs, their defaults and
// their validation rules.
//
// The service has no configuration file format of its own. Deployments build a
// Config in code, usually by calling Default and overriding the few fields
// they care about, and then call Validate before handing it to the service.
// Every field that has a units suffix in its name is in those units; fields
// without one are counts.
package config
