package road

import "errors"

// LatLon is one point of a route's place — the owner's alone (ADR-0063).
type LatLon struct{ Lat, Lon float64 }

// DecodePolyline6 reads $lib/road's encodePolyline6: Google's encoded
// polyline at 1e-6 degrees, zigzag delta varints in printable characters.
// It refuses a string that is not one — a character outside the alphabet, a
// value cut off mid-varint, a point off the globe — and stops at `limit`
// points, so a hostile string cannot make the server decode it all first.
func DecodePolyline6(s string, limit int) ([]LatLon, error) {
	var out []LatLon
	i := 0
	take := func() (int64, error) {
		var v int64
		for shift := uint(0); ; shift += 5 {
			if i >= len(s) || shift > 30 {
				return 0, errors.New("road: polyline cut off mid-value")
			}
			c := int64(s[i]) - 63
			i++
			if c < 0 || c > 63 {
				return 0, errors.New("road: polyline holds a character outside its alphabet")
			}
			v |= (c & 0x1f) << shift
			if c < 0x20 {
				break
			}
		}
		if v&1 != 0 {
			return ^(v >> 1), nil
		}
		return v >> 1, nil
	}
	var lat, lon int64
	for i < len(s) {
		if len(out) == limit {
			return nil, errors.New("road: polyline has too many points")
		}
		dLat, err := take()
		if err != nil {
			return nil, err
		}
		dLon, err := take()
		if err != nil {
			return nil, err
		}
		lat, lon = lat+dLat, lon+dLon
		p := LatLon{Lat: float64(lat) / 1e6, Lon: float64(lon) / 1e6}
		if p.Lat < -90 || p.Lat > 90 || p.Lon < -180 || p.Lon > 180 {
			return nil, errors.New("road: polyline point off the globe")
		}
		out = append(out, p)
	}
	return out, nil
}
