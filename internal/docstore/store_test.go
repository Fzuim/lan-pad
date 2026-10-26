package docstore

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"github.com/Deln0r/ygo"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := Open(filepath.Join(t.TempDir(), "lanpad.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func TestCreateDocSeedsStateAndLog(t *testing.T) {
	store := newTestStore(t)

	meta, err := store.CreateDoc("abcdefghijkl", "  中文标题  ")
	if err != nil {
		t.Fatalf("CreateDoc: %v", err)
	}
	if meta.Title != "中文标题" {
		t.Fatalf("title = %q", meta.Title)
	}
	if meta.LastEditor != nil {
		t.Fatalf("last_editor = %v, want nil", *meta.LastEditor)
	}

	var stateLen int
	if err := store.db.QueryRow(`SELECT length(state) FROM docs WHERE id = ?`, meta.ID).Scan(&stateLen); err != nil {
		t.Fatalf("state query: %v", err)
	}
	if stateLen == 0 {
		t.Fatal("docs.state is empty")
	}

	updates, err := store.GetUpdates(context.Background(), meta.ID)
	if err != nil {
		t.Fatalf("GetUpdates: %v", err)
	}
	if len(updates) != 1 {
		t.Fatalf("updates = %d, want 1", len(updates))
	}

	doc := ygo.NewDoc()
	if err := ygo.ApplyUpdate(doc, updates[0]); err != nil {
		t.Fatalf("ApplyUpdate: %v", err)
	}
	if got := ygo.NewText(doc, "title").String(); got != "中文标题" {
		t.Fatalf("Yjs title = %q", got)
	}
}

func TestStoreUpdateRefreshesMetadataAndFlushCompacts(t *testing.T) {
	store := newTestStore(t)
	meta, err := store.CreateDoc("abcdefghijkl", "初始标题")
	if err != nil {
		t.Fatal(err)
	}

	ctx := context.Background()
	for _, value := range []string{"第一段", "第二段"} {
		peer := ygo.NewDoc()
		text := ygo.NewText(peer, "body")
		txn := peer.WriteTxn()
		if err := text.Insert(txn, uint64(text.Length()), value); err != nil {
			t.Fatal(err)
		}
		txn.Commit()
		if err := store.StoreUpdate(ctx, meta.ID, ygo.EncodeStateAsUpdate(peer)); err != nil {
			t.Fatalf("StoreUpdate: %v", err)
		}
	}

	deadline := time.Now().Add(3 * time.Second)
	for {
		var stateLen int
		if err := store.db.QueryRow(`SELECT length(state) FROM docs WHERE id = ?`, meta.ID).Scan(&stateLen); err != nil {
			t.Fatal(err)
		}
		if stateLen > 20 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("metadata was not refreshed")
		}
		time.Sleep(50 * time.Millisecond)
	}

	updates, err := store.GetUpdates(ctx, meta.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(updates) < 3 {
		t.Fatalf("updates before flush = %d, want >= 3", len(updates))
	}

	if err := store.Flush(ctx, meta.ID); err != nil {
		t.Fatalf("Flush: %v", err)
	}
	updates, err = store.GetUpdates(ctx, meta.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(updates) != 1 {
		t.Fatalf("updates after flush = %d, want 1", len(updates))
	}

	doc := ygo.NewDoc()
	if err := ygo.ApplyUpdate(doc, updates[0]); err != nil {
		t.Fatal(err)
	}
	if got := ygo.NewText(doc, "body").String(); got != "第一段第二段" {
		t.Fatalf("body = %q", got)
	}
}

func TestLegacyStateIsPromotedToUpdateLog(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	peer := ygo.NewDoc()
	text := ygo.NewText(peer, "title")
	txn := peer.WriteTxn()
	if err := text.Insert(txn, 0, "legacy"); err != nil {
		t.Fatal(err)
	}
	txn.Commit()
	state := ygo.EncodeStateAsUpdate(peer)

	now := time.Now().UnixMilli()
	if _, err := store.db.Exec(
		`INSERT INTO docs (id, title, state, created_at, updated_at, last_version_at)
		 VALUES (?, ?, ?, ?, ?, 0)`,
		"legacy123456", "legacy", state, now, now,
	); err != nil {
		t.Fatal(err)
	}

	updates, err := store.GetUpdates(ctx, "legacy123456")
	if err != nil {
		t.Fatal(err)
	}
	if len(updates) != 1 {
		t.Fatalf("promoted updates = %d, want 1", len(updates))
	}
	var n int
	if err := store.db.QueryRow(
		`SELECT count(*) FROM doc_updates WHERE doc_id = ?`, "legacy123456").Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("log rows = %d, want 1", n)
	}
}

func TestSoftDeleteHidesDocument(t *testing.T) {
	store := newTestStore(t)
	meta, err := store.CreateDoc("abcdefghijkl", "待删除")
	if err != nil {
		t.Fatal(err)
	}

	deleted, err := store.SoftDeleteDoc(meta.ID)
	if err != nil || !deleted {
		t.Fatalf("SoftDeleteDoc = %v, %v", deleted, err)
	}
	got, err := store.GetDocMeta(meta.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got != nil {
		t.Fatalf("GetDocMeta returned %+v after delete", got)
	}
	deleted, err = store.SoftDeleteDoc(meta.ID)
	if err != nil || deleted {
		t.Fatalf("second SoftDeleteDoc = %v, %v", deleted, err)
	}
	var deletedAt sql.NullInt64
	if err := store.db.QueryRow(
		`SELECT deleted_at FROM docs WHERE id = ?`, meta.ID).Scan(&deletedAt); err != nil {
		t.Fatal(err)
	}
	if !deletedAt.Valid {
		t.Fatal("deleted_at is NULL")
	}
}

func TestVersionsCaptureAndDeduplicate(t *testing.T) {
	store := newTestStore(t)
	ctx := context.Background()

	meta, err := store.CreateDoc("abcdefghijkl", "初始版本")
	if err != nil {
		t.Fatal(err)
	}

	versions, err := store.ListVersions(meta.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(versions) != 1 {
		t.Fatalf("initial versions = %d, want 1", len(versions))
	}
	if versions[0].Title != "初始版本" || versions[0].SHA256 == "" || versions[0].Size == 0 {
		t.Fatalf("initial version = %+v", versions[0])
	}

	detail, err := store.GetVersion(meta.ID, versions[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if detail == nil {
		t.Fatal("GetVersion returned nil")
	}
	doc := ygo.NewDoc()
	if err := ygo.ApplyUpdate(doc, detail.State); err != nil {
		t.Fatal(err)
	}
	if got := ygo.NewText(doc, "title").String(); got != "初始版本" {
		t.Fatalf("version title = %q", got)
	}

	peer := ygo.NewDoc()
	body := ygo.NewText(peer, "body")
	txn := peer.WriteTxn()
	if err := body.Insert(txn, 0, "新增内容"); err != nil {
		t.Fatal(err)
	}
	txn.Commit()
	if err := store.StoreUpdate(ctx, meta.ID, ygo.EncodeStateAsUpdate(peer)); err != nil {
		t.Fatal(err)
	}

	created, err := store.SnapshotNow(ctx, meta.ID)
	if err != nil {
		t.Fatal(err)
	}
	if created == nil {
		t.Fatal("SnapshotNow did not create a version")
	}
	if created.Size <= versions[0].Size {
		t.Fatalf("new version size = %d, initial = %d", created.Size, versions[0].Size)
	}

	versions, err = store.ListVersions(meta.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(versions) != 2 {
		t.Fatalf("versions = %d, want 2", len(versions))
	}
	if versions[0].ID != created.ID {
		t.Fatalf("newest version id = %d, want %d", versions[0].ID, created.ID)
	}

	// No content change: a forced snapshot is a no-op.
	again, err := store.SnapshotNow(ctx, meta.ID)
	if err != nil {
		t.Fatal(err)
	}
	if again != nil {
		t.Fatalf("duplicate snapshot was stored: %+v", again)
	}
}

func TestVersionsOfUnknownVersion(t *testing.T) {
	store := newTestStore(t)
	meta, err := store.CreateDoc("abcdefghijkl", "x")
	if err != nil {
		t.Fatal(err)
	}
	detail, err := store.GetVersion(meta.ID, 99999)
	if err != nil {
		t.Fatal(err)
	}
	if detail != nil {
		t.Fatalf("detail = %+v", detail)
	}
}

func TestOpenMigratesOldVersionsTable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(`CREATE TABLE versions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		doc_id TEXT NOT NULL,
		state BLOB NOT NULL,
		title TEXT,
		created_at INTEGER NOT NULL
	)`); err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(
		`INSERT INTO versions (doc_id, state, title, created_at) VALUES (?, ?, ?, ?)`,
		"abcdefghijkl", []byte("legacy-state"), "旧版本", time.Now().UnixMilli(),
	); err != nil {
		t.Fatal(err)
	}
	_ = raw.Close()

	store, err := Open(path)
	if err != nil {
		t.Fatalf("Open legacy db: %v", err)
	}
	defer store.Close()

	var sha string
	if err := store.db.QueryRow(`SELECT sha256 FROM versions LIMIT 1`).Scan(&sha); err != nil {
		t.Fatal(err)
	}
	if len(sha) != 64 {
		t.Fatalf("backfilled sha = %q", sha)
	}
}

func TestCleanTitle(t *testing.T) {
	if got := CleanTitle("   "); got != "未命名文档" {
		t.Fatalf("empty title = %q", got)
	}
	long := ""
	for i := 0; i < 200; i++ {
		long += "字"
	}
	if got := CleanTitle(long); len([]rune(got)) != 120 {
		t.Fatalf("long title runes = %d", len([]rune(got)))
	}
}
