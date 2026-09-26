package httpx_test

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// riderText is which argument of each call a rider reads: the message of an
// errors.md refusal, a ceiling, a failure's safe line, a socket's refusal
// frame, a page. Every other argument is a code, a status or a log line.
var riderText = map[string]int{
	"WriteError":      3,
	"WriteFieldError": 3,
	"WriteCeiling":    1,
	"Fail":            4,
	"WritePage":       3,
	"writeError":      2,
}

// room is the word, not the idiom: "delete one to make room" says nothing
// about a place.
var room = regexp.MustCompile(`(?i)\brooms?\b`)

// "Room" left the vocabulary (ADR-0058, ux.md): a crew has text and voice
// channels and runs sessions. The web copy followed it and the server did not
// — refusals, a socket's pick errors and an achievement kept telling riders
// about a place the product no longer has (#2828). This reads every rider-
// facing string the server passes to those calls, plus an achievement's How.
func TestRiderFacingTextSaysNoRoom(t *testing.T) {
	fset := token.NewFileSet()
	var found []string
	check := func(lit ast.Expr) {
		b, ok := lit.(*ast.BasicLit)
		if !ok || b.Kind != token.STRING {
			return
		}
		s, err := strconv.Unquote(b.Value)
		if err != nil {
			return
		}
		if room.MatchString(strings.ReplaceAll(strings.ToLower(s), "make room", "")) {
			found = append(found, fset.Position(b.Pos()).String()+": "+s)
		}
	}
	err := filepath.WalkDir("../..", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() && (d.Name() == "tmp" || d.Name() == "node_modules") {
			return filepath.SkipDir
		}
		if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		file, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			return err
		}
		ast.Inspect(file, func(n ast.Node) bool {
			switch n := n.(type) {
			case *ast.CallExpr:
				name := ""
				switch f := n.Fun.(type) {
				case *ast.Ident:
					name = f.Name
				case *ast.SelectorExpr:
					name = f.Sel.Name
					if x, ok := f.X.(*ast.Ident); ok && x.Name == "http" && name == "Error" {
						check(n.Args[1])
						return true
					}
				}
				if i, ok := riderText[name]; ok && i < len(n.Args) {
					check(n.Args[i])
				}
			case *ast.KeyValueExpr:
				if k, ok := n.Key.(*ast.Ident); ok && k.Name == "How" {
					check(n.Value)
				}
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(found) > 0 {
		t.Errorf("rider-facing text still says room (ADR-0058) — say crew, voice channel or session:\n  %s", strings.Join(found, "\n  "))
	}
}
