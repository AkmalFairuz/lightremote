package remote

import "testing"

func TestCleanRemotePathKeepsWindowsDriveRoot(t *testing.T) {
	cases := map[string]string{
		"/":                   "/",
		"C:/":                 "C:/",
		"c:/Users/../Windows": "C:/Windows",
		"C:/../../Windows":    "C:/Windows",
	}
	for input, expected := range cases {
		actual, err := CleanRemotePath(input)
		if err != nil || actual != expected {
			t.Errorf("CleanRemotePath(%q) = %q, %v; want %q", input, actual, err, expected)
		}
	}
	if _, err := CleanRemotePath("C:relative"); err == nil {
		t.Fatal("drive-relative path was accepted")
	}
}
