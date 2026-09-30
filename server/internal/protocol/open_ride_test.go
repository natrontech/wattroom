package protocol

import (
	"reflect"
	"regexp"
	"strings"
	"testing"
)

// A stranger never gets a number or a name (ADR-0076): what an open ride
// sends every rider is checked here, field by field and down every nested
// type, so the promise is a failing test the day a field would break it —
// not a review comment. OpenRideRoster is the one exception by design, and
// only for the host crew's name, which a listed crew shows everyone anyway;
// its kit values are checked through OpenRideKit. OpenRideNames goes only to
// the viewer's own people.
func TestAnOpenRideCarriesNothingAboutAnyone(t *testing.T) {
	// Named or typed for a person or a number: watts, HR, cadence, FTP,
	// weight, Category, W/kg, zone, a name, a user or crew id, a channel, a
	// look — or a whole metrics or rider struct that carries them.
	forbidden := regexp.MustCompile(`(?i)watt|^hr$|heart|cadence|ftp|weight|^kg$|categor|wkg|zone|name|user|crewid|channel|look|metric|^rider$`)
	words := regexp.MustCompile(`[A-Z][a-z0-9]*|[a-z0-9]+`)
	offends := func(name string) bool {
		if forbidden.MatchString(name) {
			return true
		}
		for _, w := range words.FindAllString(name, -1) {
			if forbidden.MatchString(w) {
				return true
			}
		}
		return false
	}

	var walk func(t *testing.T, path string, typ reflect.Type)
	walk = func(t *testing.T, path string, typ reflect.Type) {
		for typ.Kind() == reflect.Pointer || typ.Kind() == reflect.Slice || typ.Kind() == reflect.Map {
			typ = typ.Elem()
		}
		if typ.Kind() != reflect.Struct {
			return
		}
		if offends(typ.Name()) && !strings.HasPrefix(typ.Name(), "OpenRide") {
			t.Errorf("%s is typed %s, which carries a person or a number", path, typ.Name())
		}
		for i := range typ.NumField() {
			f := typ.Field(i)
			tag, _, _ := strings.Cut(f.Tag.Get("json"), ",")
			if offends(f.Name) || offends(tag) {
				t.Errorf("%s.%s (json %q) is named for a person or a number", path, f.Name, tag)
			}
			if el := f.Type; el.Name() != "" && el.PkgPath() != "" && offends(el.Name()) {
				t.Errorf("%s.%s is typed %s", path, f.Name, el.Name())
			}
			walk(t, path+"."+f.Name, f.Type)
		}
	}
	for _, v := range []any{OpenRideRider{}, OpenRideKit{}, OpenRideTick{}, OpenRideClosing{}, OpenRideMessage{}} {
		typ := reflect.TypeOf(v)
		walk(t, typ.Name(), typ)
	}
}

// Up at 1 Hz, a rider sends what the bunch needs and nothing it does not.
func TestAnOpenRideSampleCarriesNoHeartOrLegs(t *testing.T) {
	typ := reflect.TypeFor[OpenRideSample]()
	for _, gone := range []string{"HR", "Cadence"} {
		if _, ok := typ.FieldByName(gone); ok {
			t.Errorf("OpenRideSample carries %s; an open ride does not need it", gone)
		}
	}
}
