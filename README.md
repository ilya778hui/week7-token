# ALMA Token — неделя 7: SPL Tokens и Token Extensions

Собственный токен **AlmaU Solana Coin (ALMA)** на программе **Token-2022** с расширениями
**MetadataPointer + TokenMetadata**: название, тикер, URI и дополнительные поля хранятся
прямо в mint-аккаунте — без Metaplex и внешних программ.

## Возможности клиента (`token.mjs`)

| Команда | Что делает |
|---|---|
| `create` | создаёт mint (decimals = 6) + метаданные: name, symbol, uri, `course`, `week` |
| `mint <n>` | выпускает токены на свой ATA (Associated Token Account) |
| `transfer <адрес> <n>` | `transferChecked`, ATA получателя создаётся автоматически |
| `burn <n>` | сжигает токены (`burnChecked`), supply уменьшается |
| `update <поле> <значение>` | меняет/добавляет поле метаданных, докидывает rent при росте аккаунта |
| `info` | supply, authorities, метаданные, баланс |
| `demo` | создаёт второй кошелёк и переводит ему 250 ALMA |

## Как устроено создание токена (одна транзакция)

1. `SystemProgram.createAccount` — аккаунт под mint, владелец — Token-2022.
2. `InitializeMetadataPointer` — указывает, что метаданные лежат в самом mint.
3. `InitializeMint` — decimals, mint authority, freeze authority.
4. `TokenMetadata::Initialize` — name / symbol / uri.
5. `TokenMetadata::UpdateField` ×2 — дополнительные поля.

## Результат

```text
AlmaU Solana Coin (ALMA)
program:   Token-2022 (TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb)
decimals:  6
supply:    950 ALMA          # выпущено 1000, сожжено 50
course:    IT-startup DS/ML, AlmaU
week:      7 — done          # обновлено через update
website:   https://almau.edu.kz
мой баланс: 700 ALMA         # 250 переведено другу
```

## Запуск

```bash
solana-test-validator --reset     # отдельный терминал
npm install
node token.mjs create
node token.mjs mint 1000
node token.mjs demo
node token.mjs burn 50
node token.mjs update website "https://almau.edu.kz"
node token.mjs info
```

Для Devnet: `RPC_URL=https://api.devnet.solana.com node token.mjs create`