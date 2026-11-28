package workout

import (
	"encoding/json"
	"testing"
)

func TestRelative(t *testing.T) {
	tests := []struct {
		name string
		in   string
		ftp  int
		want string // "" means unchanged
	}{
		{
			name: "watts become the picker's fraction",
			in:   `{"name":"Erg","steps":[{"type":"steady","seconds":300,"watts":120}]}`,
			ftp:  160,
			want: `{"name":"Erg","steps":[{"seconds":300,"target":0.75,"type":"steady"}]}`,
		},
		{
			name: "inside a repeat, other fields kept",
			in:   `{"name":"Erg","steps":[{"type":"repeat","times":3,"steps":[{"type":"steady","seconds":60,"watts":200,"cadenceLow":90},{"type":"steady","seconds":60,"target":0.5}]}]}`,
			ftp:  160,
			want: `{"name":"Erg","steps":[{"steps":[{"cadenceLow":90,"seconds":60,"target":1.25,"type":"steady"},{"seconds":60,"target":0.5,"type":"steady"}],"times":3,"type":"repeat"}]}`,
		},
		{
			name: "a workout in fractions is untouched",
			in:   `{"name":"SS","steps":[{"type":"steady","seconds":300,"target":0.9}]}`,
			ftp:  160,
		},
		{
			name: "the ramp test keeps its absolute ladder",
			in:   `{"name":"Ramp","unscored":true,"steps":[{"type":"steady","seconds":60,"watts":100}]}`,
			ftp:  160,
		},
		{
			name: "a heart-rate hold keeps its watts",
			in:   `{"name":"HR","steps":[{"type":"steady","seconds":600,"watts":150,"hrHold":true,"hrLow":130,"hrHigh":140}]}`,
			ftp:  160,
		},
		{
			name: "no FTP to scale by",
			in:   `{"name":"Erg","steps":[{"type":"steady","seconds":300,"watts":120}]}`,
			ftp:  0,
		},
		{
			name: "held under the ceiling",
			in:   `{"name":"Erg","steps":[{"type":"steady","seconds":10,"watts":2000}]}`,
			ftp:  100,
			want: `{"name":"Erg","steps":[{"seconds":10,"target":3,"type":"steady"}]}`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Relative(tt.in, tt.ftp)
			want := tt.want
			if want == "" {
				want = tt.in
			}
			if got != want {
				t.Fatalf("Relative =\n %s\nwant\n %s", got, want)
			}
			if tt.want != "" {
				if err := Validate(got); err != nil {
					t.Fatalf("rewritten workout no longer validates: %v", err)
				}
				var round map[string]any
				if err := json.Unmarshal([]byte(got), &round); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}

// Two riders on the rewritten workout get their own watts: the point of it.
func TestRelativeScalesPerRider(t *testing.T) {
	segments, err := Parse(Relative(`{"name":"Erg","steps":[{"type":"steady","seconds":300,"watts":120}]}`, 160))
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct{ ftp, want float64 }{{160, 120}, {200, 150}} {
		if got, _ := TargetAt(segments, c.ftp, 10); got != c.want {
			t.Errorf("FTP %v: target %v W, want %v W", c.ftp, got, c.want)
		}
	}
}
