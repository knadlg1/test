import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20261005000000_init.sql", import.meta.url),
  "utf8",
);

// Supabase가 제공하는 auth 스키마를 흉내 낸다.
const authStub = `
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
  create role app_user;
`;

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";

async function setup() {
  const db = new PGlite();
  await db.exec(authStub);
  await db.exec(migration);
  await db.exec(`
    insert into auth.users values ('${A}'), ('${B}');
    insert into profiles values ('${A}', '지은'), ('${B}', '민수');
    insert into families (id, name) values
      ('10000000-0000-0000-0000-000000000001', 'A가족'),
      ('10000000-0000-0000-0000-000000000002', 'B가족');
    insert into family_members (family_id, user_id) values
      ('10000000-0000-0000-0000-000000000001', '${A}'),
      ('10000000-0000-0000-0000-000000000002', '${B}');
    insert into media (family_id, uploader_id, kind) values
      ('10000000-0000-0000-0000-000000000001', '${A}', 'photo');
    grant usage on schema public, auth to app_user;
    grant select, insert on all tables in schema public to app_user;
  `);
  return db;
}

async function asUser(db: PGlite, uid: string, sql: string) {
  await db.exec(`set role app_user; set app.uid = '${uid}';`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec(`reset role; reset app.uid;`);
  }
}

test("같은 가족의 미디어만 보인다", async () => {
  const db = await setup();
  assert.equal((await asUser(db, A, "select * from media")).rows.length, 1);
  assert.equal((await asUser(db, B, "select * from media")).rows.length, 0);
});

test("다른 가족에는 업로드할 수 없다", async () => {
  const db = await setup();
  await assert.rejects(
    asUser(
      db,
      B,
      `insert into media (family_id, uploader_id, kind) values
        ('10000000-0000-0000-0000-000000000001', '${B}', 'photo')`,
    ),
  );
});

test("업로드할 때 상태를 ready로 직접 지정할 수 없다", async () => {
  const db = await setup();
  await assert.rejects(
    asUser(
      db,
      A,
      `insert into media (family_id, uploader_id, kind, status) values
        ('10000000-0000-0000-0000-000000000001', '${A}', 'photo', 'ready')`,
    ),
  );
});
