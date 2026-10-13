// Неделя 7 — собственный токен на Token-2022 (Token Extensions).
// Расширения: MetadataPointer + TokenMetadata (метаданные хранятся прямо в mint-аккаунте).
//
// Команды:
//   node token.mjs create                    — создать токен (mint + метаданные)
//   node token.mjs mint <amount>             — выпустить токены себе
//   node token.mjs transfer <адрес> <amount> — перевести (ATA получателя создастся сам)
//   node token.mjs burn <amount>             — сжечь свои токены
//   node token.mjs update <поле> <значение>  — изменить/добавить поле метаданных
//   node token.mjs info                      — supply, метаданные, баланс
//   node token.mjs demo                      — сценарий: создать друга и перевести ему
//
// Сеть: RPC_URL (по умолчанию локальный валидатор http://127.0.0.1:8899)
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, ExtensionType, TYPE_SIZE, LENGTH_SIZE,
  getMintLen, getMint, getAccount, getTokenMetadata,
  createInitializeMetadataPointerInstruction, createInitializeMintInstruction,
  getOrCreateAssociatedTokenAccount, getAssociatedTokenAddressSync,
  mintTo, transferChecked, burnChecked,
} from "@solana/spl-token";
import { createInitializeInstruction, createUpdateFieldInstruction, pack } from "@solana/spl-token-metadata";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const DECIMALS = 6;
const MINT_FILE = "mint.json";

const TOKEN = {
  name: "AlmaU Solana Coin",
  symbol: "ALMA",
  uri: "https://raw.githubusercontent.com/solana-developers/opos-asset/main/assets/DeveloperPortal/metadata.json",
  extra: [
    ["course", "IT-startup DS/ML, AlmaU"],
    ["week", "7"],
  ],
};

const connection = new Connection(RPC_URL, "confirmed");
const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json"), "utf8")))
);

const toUnits = (x) => BigInt(Math.round(Number(x) * 10 ** DECIMALS));
const fromUnits = (x) => (Number(x) / 10 ** DECIMALS).toLocaleString("en-US", { maximumFractionDigits: DECIMALS });

function loadMint() {
  if (!fs.existsSync(MINT_FILE)) throw new Error("Токен ещё не создан — выполни: node token.mjs create");
  return new PublicKey(JSON.parse(fs.readFileSync(MINT_FILE, "utf8")).mint);
}

// ------------------------------------------------------------------ create
async function create() {
  const mintKp = Keypair.generate();
  const mint = mintKp.publicKey;

  const metadata = {
    mint,
    name: TOKEN.name,
    symbol: TOKEN.symbol,
    uri: TOKEN.uri,
    additionalMetadata: TOKEN.extra,
    updateAuthority: payer.publicKey,
  };

  // Размер mint-аккаунта: базовый mint + расширение MetadataPointer.
  // Сами метаданные Token-2022 допишет (realloc) при initialize — под них заранее кладём лампорты.
  const mintLen = getMintLen([ExtensionType.MetadataPointer]);
  const metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen + metadataLen);

  const tx = new Transaction().add(
    // 1. создать аккаунт под mint, владелец — программа Token-2022
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    // 2. указатель: «метаданные лежат в самом mint»
    createInitializeMetadataPointerInstruction(mint, payer.publicKey, mint, TOKEN_2022_PROGRAM_ID),
    // 3. инициализировать mint: decimals, mint authority, freeze authority
    createInitializeMintInstruction(mint, DECIMALS, payer.publicKey, payer.publicKey, TOKEN_2022_PROGRAM_ID),
    // 4. записать name / symbol / uri
    createInitializeInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      metadata: mint,
      updateAuthority: payer.publicKey,
      mint,
      mintAuthority: payer.publicKey,
      name: metadata.name,
      symbol: metadata.symbol,
      uri: metadata.uri,
    }),
    // 5. дополнительные поля метаданных
    ...TOKEN.extra.map(([field, value]) =>
      createUpdateFieldInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        metadata: mint,
        updateAuthority: payer.publicKey,
        field,
        value,
      })
    )
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [payer, mintKp]);
  fs.writeFileSync(MINT_FILE, JSON.stringify({ mint: mint.toBase58(), rpc: RPC_URL }, null, 2));
  console.log(`✅ Токен создан: ${mint.toBase58()}\n   tx: ${sig}`);
  await info();
}

// ------------------------------------------------------------------ mint
async function mintTokens(amount) {
  const mint = loadMint();
  const ata = await getOrCreateAssociatedTokenAccount(
    connection, payer, mint, payer.publicKey, false, "confirmed", undefined, TOKEN_2022_PROGRAM_ID
  );
  const sig = await mintTo(connection, payer, mint, ata.address, payer, toUnits(amount), [], undefined, TOKEN_2022_PROGRAM_ID);
  console.log(`✅ Выпущено ${amount} ${TOKEN.symbol} на ${ata.address.toBase58()}\n   tx: ${sig}`);
}

// ------------------------------------------------------------------ transfer
async function transfer(to, amount) {
  const mint = loadMint();
  const recipient = new PublicKey(to);
  const fromAta = getAssociatedTokenAddressSync(mint, payer.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const toAta = await getOrCreateAssociatedTokenAccount(
    connection, payer, mint, recipient, false, "confirmed", undefined, TOKEN_2022_PROGRAM_ID
  );
  const sig = await transferChecked(
    connection, payer, fromAta, mint, toAta.address, payer, toUnits(amount), DECIMALS, [], undefined, TOKEN_2022_PROGRAM_ID
  );
  console.log(`✅ Переведено ${amount} ${TOKEN.symbol} → ${recipient.toBase58()}\n   ATA получателя: ${toAta.address.toBase58()}\n   tx: ${sig}`);
}

// ------------------------------------------------------------------ burn
async function burn(amount) {
  const mint = loadMint();
  const ata = getAssociatedTokenAddressSync(mint, payer.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const sig = await burnChecked(connection, payer, ata, mint, payer, toUnits(amount), DECIMALS, [], undefined, TOKEN_2022_PROGRAM_ID);
  console.log(`🔥 Сожжено ${amount} ${TOKEN.symbol}\n   tx: ${sig}`);
}

// ------------------------------------------------------------------ update metadata
async function update(field, value) {
  const mint = loadMint();
  // Новое поле может увеличить размер аккаунта — докидываем лампорты под rent заранее.
  const current = await getTokenMetadata(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
  const extra = current.additionalMetadata.filter(([k]) => k !== field);
  const known = ["name", "symbol", "uri"].includes(field);
  const next = {
    ...current,
    [field]: known ? value : current[field],
    additionalMetadata: known ? current.additionalMetadata : [...extra, [field, value]],
  };
  const acc = await connection.getAccountInfo(mint);
  const grow = Math.max(0, pack(next).length - pack(current).length);
  const needed = await connection.getMinimumBalanceForRentExemption(acc.data.length + grow);
  const topUp = Math.max(0, needed - acc.lamports);

  const tx = new Transaction();
  if (topUp > 0) tx.add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: mint, lamports: topUp }));
  tx.add(
    createUpdateFieldInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      metadata: mint,
      updateAuthority: payer.publicKey,
      field,
      value,
    })
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [payer]);
  console.log(`✅ Метаданные: ${field} = "${value}"\n   tx: ${sig}`);
  await info();
}

// ------------------------------------------------------------------ info
async function info() {
  const mint = loadMint();
  const m = await getMint(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
  const md = await getTokenMetadata(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
  console.log(`\n  ${md.name} (${md.symbol})`);
  console.log(`  mint:      ${mint.toBase58()}`);
  console.log(`  program:   Token-2022 (${TOKEN_2022_PROGRAM_ID.toBase58()})`);
  console.log(`  decimals:  ${m.decimals}`);
  console.log(`  supply:    ${fromUnits(m.supply)} ${md.symbol}`);
  console.log(`  mint auth: ${m.mintAuthority?.toBase58() ?? "нет"}`);
  console.log(`  uri:       ${md.uri}`);
  for (const [k, v] of md.additionalMetadata) console.log(`  ${k}: ${v}`);

  const ata = getAssociatedTokenAddressSync(mint, payer.publicKey, false, TOKEN_2022_PROGRAM_ID);
  try {
    const acc = await getAccount(connection, ata, "confirmed", TOKEN_2022_PROGRAM_ID);
    console.log(`  мой баланс: ${fromUnits(acc.amount)} ${md.symbol}  (ATA ${ata.toBase58()})\n`);
  } catch {
    console.log(`  мой баланс: 0 (ATA ещё не создан)\n`);
  }
}

// ------------------------------------------------------------------ demo
async function demo() {
  const friend = Keypair.generate();
  console.log(`Друг: ${friend.publicKey.toBase58()}`);
  if (RPC_URL.includes("127.0.0.1") || RPC_URL.includes("localhost")) {
    const s = await connection.requestAirdrop(friend.publicKey, LAMPORTS_PER_SOL);
    await connection.confirmTransaction(s, "confirmed");
  }
  await transfer(friend.publicKey.toBase58(), 250);
  const mint = loadMint();
  const friendAta = getAssociatedTokenAddressSync(mint, friend.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const acc = await getAccount(connection, friendAta, "confirmed", TOKEN_2022_PROGRAM_ID);
  console.log(`  баланс друга: ${fromUnits(acc.amount)} ${TOKEN.symbol}`);
  await info();
}

// ------------------------------------------------------------------ main
const [cmd, a1, a2] = process.argv.slice(2);
console.log(`RPC: ${RPC_URL}   кошелёк: ${payer.publicKey.toBase58()}`);
try {
  switch (cmd) {
    case "create":   await create(); break;
    case "mint":     await mintTokens(a1 ?? "1000"); break;
    case "transfer": await transfer(a1, a2 ?? "1"); break;
    case "burn":     await burn(a1 ?? "1"); break;
    case "update":   await update(a1, a2 ?? ""); break;
    case "info":     await info(); break;
    case "demo":     await demo(); break;
    default:
      console.log("Команды: create | mint <n> | transfer <адрес> <n> | burn <n> | update <поле> <значение> | info | demo");
      process.exit(1);
  }
} catch (e) {
  console.error("❌", e.message ?? e);
  if (e.logs) console.error(e.logs.join("\n"));
  process.exit(1);
}