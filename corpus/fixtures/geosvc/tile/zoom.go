package tile

import (
	"math"

	"geosvc/geom"
)

// TilePixels is the edge length in pixels of a rendered raster tile.
const TilePixels = 256

// Resolution returns the ground resolution in metres per pixel at the given
// zoom and latitude.
func Resolution(z int, lat float64) float64 {
	n := float64(Size(z))
	if n == 0 {
		return 0
	}
	circumference := 2 * math.Pi * geom.EarthRadiusMeters
	return circumference * math.Cos(lat*math.Pi/180) / (n * TilePixels)
}

// ScaleDenominator returns the traditional map scale denominator at the given
// zoom and latitude, assuming a 0.28mm screen pixel.
func ScaleDenominator(z int, lat float64) float64 {
	return Resolution(z, lat) / 0.00028
}

// ZoomForResolution returns the shallowest zoom whose resolution at the given
// latitude is at least as fine as the requested metres per pixel.
func ZoomForResolution(metersPerPixel, lat float64) int {
	for z := 0; z <= MaxZoom; z++ {
		if Resolution(z, lat) <= metersPerPixel {
			return z
		}
	}
	return MaxZoom
}

// PixelBounds returns the pixel coordinates of the tile's north-west corner in
// the global pixel plane at its zoom.
func (t Tile) PixelBounds() (px, py int) {
	return t.X * TilePixels, t.Y * TilePixels
}
