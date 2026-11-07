package connections

import "testing"

func ptr[T any](v T) *T { return &v }

func TestApplyDefaults(t *testing.T) {
	c := &Connection{}
	err := Input{Name: ptr("r2"), Provider: ptr("r2"), Endpoint: ptr("https://acc.r2.cloudflarestorage.com/"),
		AccessKeyID: ptr("k"), SecretAccessKey: ptr("s")}.Apply(c)
	if err != nil {
		t.Fatal(err)
	}
	if c.Region != "auto" || c.Endpoint != "https://acc.r2.cloudflarestorage.com" {
		t.Fatalf("%+v", c)
	}
	m := &Connection{}
	_ = Input{Name: ptr("m"), Provider: ptr("minio"), Endpoint: ptr("http://minio:9000"), AccessKeyID: ptr("k"), SecretAccessKey: ptr("s")}.Apply(m)
	if !m.ForcePathStyle || m.Region != "us-east-1" {
		t.Fatalf("%+v", m)
	}
}

func TestApplyValidation(t *testing.T) {
	if err := (Input{Name: ptr("x"), Provider: ptr("minio"), AccessKeyID: ptr("k"), SecretAccessKey: ptr("s")}).Apply(&Connection{}); err == nil {
		t.Fatal("minio sem endpoint deveria falhar")
	}
	if err := (Input{Name: ptr("x"), Provider: ptr("ftp"), AccessKeyID: ptr("k"), SecretAccessKey: ptr("s")}).Apply(&Connection{}); err == nil {
		t.Fatal("provider inválido deveria falhar")
	}
	// PATCH sem secret mantém a existente
	c := &Connection{Name: "a", Provider: "s3", AccessKeyID: "k", SecretAccessKey: "old"}
	if err := (Input{SecretAccessKey: ptr("")}).Apply(c); err != nil || c.SecretAccessKey != "old" {
		t.Fatalf("secret perdida: %v %+v", err, c)
	}
}

func TestIsUUID(t *testing.T) {
	if !isUUID("3f2504e0-4f89-11d3-9a0c-0305e82c3301") || isUUID("nope") || isUUID("3f2504e0x4f89-11d3-9a0c-0305e82c3301") {
		t.Fatal("isUUID")
	}
}
