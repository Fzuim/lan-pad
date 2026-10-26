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
