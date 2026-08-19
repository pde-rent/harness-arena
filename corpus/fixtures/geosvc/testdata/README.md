# testdata

`workload.json` is one representative ten-minute window from the edge access
log of a default deployment.

- `windowSeconds` is the length of the window the counts were taken over.
- `zoom` is the tile zoom every logged request was served at.
- `requestsByTile` maps a tile, in `z/x/y` form, to the number of requests the
  edge made for it during the window. Tiles that were never requested during
  the window do not appear.

The file is committed so that capacity planning is reproducible: it is the only
workload input to the sizing model, and it is never read by the service itself.
