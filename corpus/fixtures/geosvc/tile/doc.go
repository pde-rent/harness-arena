// Package tile implements slippy-map tile arithmetic: the Web Mercator
// projection used by the tile endpoints, quadkey encoding, and the bbox
// coverage helpers the index uses to decide which tiles a query touches.
//
// Tile coordinates follow the usual convention: x increases eastward from the
// antimeridian and y increases southward from the north pole, so tile (0,0) at
// any zoom is the north-west corner of the world.
package tile
