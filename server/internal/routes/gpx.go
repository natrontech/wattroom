package routes

import (
	"bytes"
	"encoding/xml"
	"fmt"

	"github.com/natrontech/wattroom/server/internal/road"
)

// GPX is a route as its owner takes it away (ADR-0053, ADR-0063): the place,
// point by point, with the road's heights along it. The shape holds a point
// every ~10 m and the road a height every ~20 m, so each point takes the
// height at its own fraction of the way — the same answer either spacing
// gives, without assuming one.
func GPX(name string, place []road.LatLon, heights []float64) []byte {
	var b bytes.Buffer
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
	b.WriteString(`<gpx version="1.1" creator="WattRoom" xmlns="http://www.topografix.com/GPX/1/1">` + "\n<trk><name>")
	_ = xml.EscapeText(&b, []byte(name))
	b.WriteString("</name><trkseg>\n")
	for i, p := range place {
		fmt.Fprintf(&b, `<trkpt lat="%.6f" lon="%.6f"><ele>%.2f</ele></trkpt>`+"\n",
			p.Lat, p.Lon, heightAt(heights, float64(i)/float64(max(1, len(place)-1))))
	}
	b.WriteString("</trkseg></trk></gpx>\n")
	return b.Bytes()
}

// heightAt is the height a fraction f of the way along the road.
func heightAt(heights []float64, f float64) float64 {
	if len(heights) == 0 {
		return 0
	}
	at := f * float64(len(heights)-1)
	i := min(int(at), len(heights)-1)
	if i == len(heights)-1 {
		return heights[i]
	}
	return heights[i] + (heights[i+1]-heights[i])*(at-float64(i))
}
