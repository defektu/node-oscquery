# Kod İnceleme Bulguları ve Düzeltme Planı

Bu doküman, projenin ikinci kez baştan sona incelenmesi sonucu bulunan **gözden kaçmış sorunları** ve bunların düzeltme planını içerir. İnceleme şu şekilde yapıldı:

1. Tüm `lib/*.ts`, `index.ts`, `test/*.ts` dosyaları satır satır okundu
2. Resmi [OSCQuery Proposal](https://github.com/Vidvox/OSCQueryProposal) spec dokümanı ile davranış karşılaştırıldı
3. `package.json`, `tsconfig.json`, `.npmignore`, build çıktısı (`dist/`) incelendi
4. `npm publish --dry-run` çıktısı analiz edildi

Bulgular önem sırasına göre gruplandırıldı. Her madde **dosya, satır, neden sorun olduğu ve önerilen çözüm** içerir.

---

## 🔴 Öncelik: Kritik (Doğruluk / Standart Uyumluluğu)

### 1. OSC binary decoder'da `break` bug'ı — bozuk parsing, çökme değil ama sessiz veri bozulması

**Dosya:** `lib/osc_websocket_server.ts`, `_decodeOSCMessage()` (satır ~403-520)

**Sorun:** `for` döngüsü içindeki `switch` bloklarında, buffer sınır kontrolü başarısız olduğunda kullanılan `break;` ifadesi **switch'i** kırar, **for döngüsünü değil**. Örneğin:

```ts
case "i": // int32
    if (offset + 4 > buffer.length) break; // <-- sadece switch'ten çıkar
    value = buffer.readInt32BE(offset);
    offset += 4;
    break;
```

`offset` ilerletilmediği için döngü, bozulmuş/kesilmiş veriyi bir sonraki type-tag karakteriyle **yanlış konumdan** okumaya devam eder. Sonuç: çökme yok ama tamamen anlamsız değerler üretiliyor. Bu davranış `i, f, s, S, b, h, t, d, c, r, m` tag'lerinin **hepsinde** var (sistemik).

**Çözüm:** Etiketli (labeled) döngü kullanıp bounds-check başarısız olduğunda döngüyü tamamen sonlandırmak:

```ts
parseArgs: for (let i = 0; i < typeTag.length && offset < buffer.length; i++) {
    switch (type) {
        case "i":
            if (offset + 4 > buffer.length) break parseArgs;
            ...
    }
}
```

---

### 2. Discovery client, spec'in "kısayol" (shorthand) gösterimini parse edemiyor

**Dosya:** `lib/osc_query_discovery.ts`, `deserializeMethodNode()` (satır 106-142)

**Spec'ten alıntı** ("Other notes on attributes"):
> "If all of the elements of one of these optional attributes [VALUE, RANGE, EXTENDED_TYPE, UNIT, CLIPMODE] share the same value, it's acceptable to only list a single value instead of an array."

Yani uyumlu bir OSCQuery sunucusu (bizim implementasyonumuz değil, örn. VVOSCQueryProtocol gibi başka bir sunucu), örneğin `RANGE: {"MIN":0,"MAX":1}` (dizi değil, tek obje) gönderebilir ve bunun tüm argümanlar için geçerli olduğu anlaşılmalıdır.

**Şu anki davranış:**
- `RANGE` için: `node.RANGE[i]` ile obje indekslenir → `undefined` döner → `deserializeRange(undefined)` çağrılır → **`range.min` erişiminde `TypeError` fırlatılır, discovery tamamen çöker.**
- `CLIPMODE`/`EXTENDED_TYPE`/`UNIT` için: `node.CLIPMODE[i]` bir string'i indeksler (örn. `"low"[0]` → `"l"`) → **sessizce yanlış/bozuk veri** üretilir, hata fırlatılmaz.

**Etki:** Kütüphanemiz, standardın izin verdiği kısayol gösterimini kullanan **herhangi bir başka OSCQuery sunucusuyla** (kendi sunucumuz hariç, çünkü biz hiç kısayol kullanmıyoruz) konuşurken discovery'nin çökmesine veya yanlış veri üretmesine neden olur. Bu, "standarda tam uyum" hedefiyle doğrudan çelişen bir boşluk.

**Çözüm:** Genel bir `expandShorthand<T>(attr: T | T[] | null | undefined, argCount: number): (T | null)[]` yardımcı fonksiyonu ekleyip `RANGE`, `CLIPMODE`, `EXTENDED_TYPE`, `UNIT` (ve mümkünse `VALUE`) için `Array.isArray()` kontrolü yapılıp değilse tüm argümanlara aynı değerin uygulanması.

---

### 3. `EXTENDED_TYPE` / `UNIT` için nested-array desteği eksik (tip tanımı yanlış)

**Dosyalar:** `lib/osc_method_description.ts` (satır 17-18), `lib/osc_node.ts` (satır 221, 230-231, 250-256), `lib/osc_query_discovery.ts` (satır 128-134)

**Sorun:** `osc_types.ts` içinde zaten `OSCQExtendedType` ve `OSCQUnit` recursive (nested array destekleyen) tipleri tanımlanmış:

```ts
export type OSCQExtendedType = string | null | OSCQExtendedType[];
export type OSCQUnit = string | null | OSCQUnit[];
```

Ama `OSCMethodArgument` arayüzünde bu tipler **kullanılmamış**, yerine düz `string` kullanılmış:

```ts
export interface OSCMethodArgument {
	...
	extendedType?: string,  // ❌ olması gereken: OSCQExtendedType
	unit?: string,           // ❌ olması gereken: OSCQUnit
	...
}
```

Spec'e göre `EXTENDED_TYPE` ve `UNIT`, `RANGE` ve `CLIPMODE` ile **aynı yapıya** sahip olmalı (TYPE'daki `[...]` array-designator'ları JSON array olarak yansıtılmalı). Şu an `RANGE` için bunu yapan `serializeRange()`/`deserializeRange()` fonksiyonları var, ama `EXTENDED_TYPE`/`UNIT` için eşdeğer bir `serializeExtendedType()`/`serializeUnit()` yok — düz string olarak push ediliyor. Array-type argümanlarda (örn. `TYPE: "i[ff]i"`) bu attribute'ları doğru şekilde ifade etmek şu anda **mümkün değil**.

**Çözüm:**
- `OSCMethodArgument.extendedType` → `OSCQExtendedType`, `unit` → `OSCQUnit` olarak güncelle
- `serializeRange`'e benzer `serializeExtendedType`/`serializeUnit` fonksiyonları ekle (osc_node.ts)
- `deserializeRange`'e benzer `deserializeExtendedType`/`deserializeUnit` fonksiyonları ekle (osc_query_discovery.ts)
- `SerializedNode.EXTENDED_TYPE`/`UNIT` tiplerini buna göre güncelle

---

### 4. `console.log` kalıntıları — logger tam entegre edilmemiş

**Dosya:** `lib/osc_websocket_server.ts`, `_handleWebSocketMessage()` (satır 353, 361)

```ts
case "LISTEN": {
	...
	console.log("Client subscribed to path:", path);  // ❌ this._logger kullanılmalı
	...
case "IGNORE": {
	...
	console.log("Client unsubscribed from path:", path);  // ❌
```

Önceki iyileştirme turunda "tüm console.log çağrılarını logger ile değiştir" hedefi tam sağlanmamış — bu iki satır atlanmış. Kullanıcı `logger: false` (varsayılan) verse bile bu iki satır konsola yazmaya devam ediyor.

**Çözüm:** `this._logger.log?.(...)` ile değiştir.

---

### 5. `HOST_INFO.EXTENSIONS` içinde `PATH_RENAMED` eksik

**Dosya:** `lib/osc_query_server.ts`, `EXTENSIONS` sabiti (satır 34-50) ve `_handleGet()` (satır 224-243)

**Sorun:** `OSCQueryWebSocketServer.broadcastPathRenamed()` implemente edilmiş ve `OSCQueryServer.broadcastPathRenamed()` public API'sinden çağrılabiliyor. Ancak `EXTENSIONS` sabitinde ve `HOST_INFO` yanıtında `PATH_RENAMED: true` **hiç deklare edilmiyor**. Spec'e göre bir client, `EXTENSIONS` objesinde listelenmeyen bir attribute'u desteklenmiyor olarak kabul eder — yani şu anki haliyle kütüphanemiz PATH_RENAMED desteğini "gizliyor", bu da client'ların bu özelliği kullanmaktan çekinmesine yol açar.

**Çözüm:** `EXTENSIONS` sabitine `PATH_RENAMED: true` ekle, `_handleGet()`'teki koşullu WebSocket-extension bloğuna da ekle (LISTEN/PATH_CHANGED/PATH_ADDED/PATH_REMOVED ile aynı grupta).

---

## 🟠 Öncelik: Yüksek (Paket / Release Hijyeni)

### 6. `tsconfig.json`'da `include`/`exclude` yok → `dist/` içine test ve dev-config dosyaları sızıyor

**Dosya:** `tsconfig.json`

`npm run build` çalıştığında (doğruladım):

```
dist/test/osc_node.test.js
dist/test/osc_node.test.d.ts
dist/vitest.config.js
dist/vitest.config.d.ts
dist/example/*.js  (example/ de dahil oluyor, .npmignore bunu publish sırasında filtreliyor ama build kirli)
```

Bunun sebebi `tsconfig.json`'da `include`/`exclude` alanlarının olmaması — TypeScript, proje kökündeki **her `.ts` dosyasını** derliyor.

**Çözüm:** `tsconfig.json`'a ekle:
```json
"include": ["index.ts", "lib/**/*.ts"],
"exclude": ["node_modules", "dist", "test", "example", "vitest.config.ts"]
```

### 7. `package.json`'da `files` whitelist yok → npm paketi şişkin

`npm publish --dry-run` çıktısı (doğruladım), paketin şunları içerdiğini gösteriyor: `RELEASE_STRATEGY.md`, `FUTURE_IMPROVEMENTS.md`, tüm `lib/*.ts` kaynak dosyaları, `test/*.ts`, `tsconfig.test.json`, `vitest.config.ts`, ve (madde 6 düzeltilmezse) `dist/test/*`.

**Çözüm:** `package.json`'a ekle:
```json
"files": ["dist", "README.md", "LICENSE", "CHANGELOG.md"]
```
Bu, `.npmignore`'dan daha güvenilirdir (whitelist yaklaşımı blacklist'ten daha az hataya açık).

### 8. `package-lock.json` senkron değil

**Dosya:** `package-lock.json` (satır 2-3, 8-9)

Hâlâ `"name": "oscquery"`, `"version": "1.1.3"` gösteriyor — `package.json` `@defektu/oscquery@2.0.0` olarak güncellendi ama lockfile yeniden üretilmedi.

**Çözüm:** `npm install` çalıştırıp lockfile'ı yeniden üret, commit'e ekle.

### 9. `sanitizeName()`'de off-by-one yorum/hesap hatası

**Dosya:** `lib/osc_query_server.ts`, satır 82, 130

Yorum "`._oscjson._tcp` suffix = 13 bytes" diyor ama gerçek uzunluk **14** karakter (`.`,`_`,`o`,`s`,`c`,`j`,`s`,`o`,`n`,`.`,`_`,`t`,`c`,`p`). `maxServiceNameLength = 255 - 13` hesaplaması bu yüzden 1 byte fazla izin veriyor (pratikte çok uzun servis isimleri olmadan hiç tetiklenmez, ama doğruluk açısından düzeltilmeli).

**Çözüm:** `255 - 14` yap, yorumu düzelt.

---

## 🟡 Öncelik: Orta (API Tamlığı / DX)

### 10. `Logger` arayüzü iki dosyada aynen kopyalanmış

**Dosyalar:** `lib/osc_query_server.ts` (satır 13-17), `lib/osc_websocket_server.ts` (satır 3-7)

Aynı `Logger` interface'i birebir iki yerde tanımlı (DRY ihlali). Ayrıca logger init mantığı (`true`→console, `false`/`undefined`→no-op, obje→kullan) da iki dosyada tekrarlanmış.

**Çözüm:** `lib/logger.ts` oluştur, `Logger` tipini ve `createLogger(opts)` yardımcı fonksiyonunu buraya taşı, her iki dosyada import et.

### 11. `index.ts`'den eksik export'lar

`Logger`, `OSCQueryWebSocketServer`, `OSCQueryWebSocketServerOptions` public API'den export edilmiyor. Kullanıcılar:
- Custom logger yazarken tip güvenliği olmadan obje literal'i geçmek zorunda kalıyor
- WebSocket sunucusunu `OSCQueryServer`'dan bağımsız kullanamıyor (zaten `lib/` içinden import etmek de mümkün ama bu, paketin resmi public API yüzeyi olan `index.ts`'i atlamak anlamına gelir)

**Çözüm:** Madde 10'daki `lib/logger.ts`'den `Logger`'ı, `lib/osc_websocket_server.ts`'den `OSCQueryWebSocketServer` ve `OSCQueryWebSocketServerOptions`'ı `index.ts`'e ekle.

### 12. Custom error sınıflarının çoğu hiç kullanılmıyor (dead code)

**Dosya:** `lib/errors.ts`

`PathNotFoundError`, `PathAccessError`, `InvalidAttributeError`, `NetworkError`, `SerializationError` tanımlı ama **kodda hiç `throw` edilmiyor**. Sadece `ArgumentIndexError` kullanılıyor (`osc_node.ts`). Buna karşın:

- `OSCNode.addChild()` (osc_node.ts:150) hâlâ düz `Error` fırlatıyor: `throw new Error(\`The child ${path} already exist\`)`
- `DiscoveredService.hostInfo`/`nodes` getter'ları (osc_query_discovery.ts:218, 225) düz `Error` fırlatıyor
- `DiscoveredService.update()` (osc_query_discovery.ts:233) axios hatalarını hiç sarmalıyor, ham axios error'u dışarı sızıyor

**Çözüm:**
- `addChild()` → yeni bir hata sınıfı ekle (örn. `DuplicateChildError`) veya mevcut `OSCQueryError` kullan
- `hostInfo`/`nodes` getter'ları → yeni `NotLoadedError` sınıfı veya `OSCQueryError`
- `update()` → axios hatalarını `NetworkError` ile, JSON/parse hatalarını `SerializationError` ile sarmala

### 13. `OSCQueryWebSocketServerOptions.server: any`

**Dosya:** `lib/osc_websocket_server.ts`, satır 22

`server?: any; // http.Server for attached mode` — tip güvenliği kaybediliyor. `node:http`'den `Server` import edilip kullanılmalı.

---

## 🟢 Öncelik: Düşük (Tutarlılık / Gelecek İyileştirme)

### 14. `start()`'ın döndürdüğü `HostInfo.extensions`, canlı `?HOST_INFO` yanıtıyla teorik olarak diverge edebilir

`osc_query_server.ts` satır 425: `extensions: EXTENSIONS` her zaman statik/tam objeyi döndürüyor (LISTEN/PATH_CHANGED/PATH_ADDED/PATH_REMOVED dahil), oysa gerçek HTTP `?HOST_INFO` endpoint'i bunları sadece `this._wsServer.isRunning()` ise ekliyor. Bugün pratik bir sorun değil (WS sunucusu `start()` içinde her zaman başlatılıyor) ama kırılgan bir tutarsızlık — aynı dinamik listeyi kullanan bir yardımcı fonksiyona çıkarılmalı.

### 15. `_handleGet()` her attribute sorgusunda tüm alt ağacı serialize ediyor

`node.serialize()` çağrısı, `CONTENTS` içindeki **tüm alt düğümleri recursive olarak** serialize ediyor — büyük bir container için sadece `?DESCRIPTION` gibi tek bir attribute istendiğinde bile bu gereksiz. Büyük adres uzaylarında performans sorunu olabilir. (Şimdilik düşük öncelik; büyük ölçekli kullanım senaryosu olursa optimize edilmeli — attribute sorgularında `CONTENTS` hesaplamayı atlayan hafif bir serialize modu eklenebilir.)

### 16. `removeMethod()`'da cascade silinen ata container'lar için `PATH_CHANGED` yerine `PATH_REMOVED` daha doğru olabilir

Bir leaf silindiğinde artık boşalan üst container'lar da zincirleme siliniyor (`osc_query_server.ts` satır 490-498), ama bunlar için sadece `PATH_CHANGED` broadcast ediliyor. O node artık **tamamen yok**, dolayısıyla `PATH_REMOVED` semantik olarak daha doğru olabilir. Spec bu konuda kesin değil ("adding/removing/renaming... would all result in a PATH_CHANGED message" diyor), şu anki davranış spec'i ihlal etmiyor ama tartışmaya açık — küçük bir iyileştirme.

### 17. `FUTURE_IMPROVEMENTS.md` güncel değil

Madde 8 "TypeScript Strict Mode — Durum: Strict mode kapalı" diyor, ama `tsconfig.json`'da `"strict": true` zaten aktif. Doküman güncellenmeli veya bu madde kaldırılmalı.

### 18. README'deki CI badge'i yalan söylüyor

`README.md` satır 6: `[![Tests](...)](https://github.com/defektu/node-oscquery/actions)` — ama `.github/workflows/` **hiç yok**. Badge tıklandığında boş/404 bir Actions sayfası görülecek. Ya CI pipeline kurulmalı (bkz. `FUTURE_IMPROVEMENTS.md` madde 2) ya da badge kaldırılmalı.

### 19. Test kapsamı hâlâ çok sınırlı

Sadece `OSCNode` serialization/value testleri var (9 test). `OSCQueryServer`, `OSCQueryWebSocketServer` (özellikle OSC binary encode/decode — madde 1'deki bug'ı test bile yakalayabilirdi!), `OSCQueryDiscovery` (madde 2'deki shorthand parsing bug'ını yakalayabilirdi), `MDNSDiscovery`, ve `lib/errors.ts` için **sıfır** test var.

### 20. WebSocket mesaj boyutu sınırı yok

`ws` kütüphanesi varsayılan `maxPayload` değeri var (100MB) ama bu proje için özellikle küçük bir değer set edilmemiş. Güvenlik/DoS açısından, `OSCQueryWebSocketServerOptions`'a opsiyonel `maxPayload` eklenmesi düşünülebilir.

---

## Uygulama Sırası Önerisi

Sorunları şu sırayla düzeltmeyi öneririm (bağımlılık ve risk azından yükseğe):

1. **Madde 4** (console.log kalıntıları) — 2 satır, riski yok
2. **Madde 5** (PATH_RENAMED extension) — küçük, riski yok
3. **Madde 9** (off-by-one yorum) — küçük, riski yok
4. **Madde 1** (OSC decoder break bug) — izole, test edilebilir
5. **Madde 3** (EXTENDED_TYPE/UNIT tipleri) — osc_types zaten hazır, node.ts + discovery.ts + method_description.ts güncellenecek
6. **Madde 2** (shorthand parsing) — madde 3'ten sonra yapılırsa aynı deserializasyon fonksiyonlarını bir kere düzenlemiş oluruz
7. **Madde 10-13** (Logger consolidation, exports, error sınıfları, `any` tipi) — API yüzeyini etkiler, dikkatli yapılmalı ama breaking change değil
8. **Madde 6-8** (build/release hijyeni: tsconfig include/exclude, package.json files, lockfile) — release öncesi mutlaka yapılmalı
9. **Madde 14-20** — zaman kalırsa veya ayrı bir turda

Tüm bu değişiklikler **geriye dönük uyumlu** (breaking change yok) — sadece yeni davranış ekleniyor, mevcut public API imzaları değişmiyor (madde 3 hariç: `extendedType`/`unit` tipi `string`'den `OSCQExtendedType`/`OSCQUnit`'e geçecek, ama bu tipler `string | null | T[]` olduğundan mevcut `string` değerleri hâlâ geçerli — teknik olarak backward-compatible bir genişletme).

---

**Sonraki adım:** Onay verirseniz bu maddeleri sırayla implemente edip test edeyim, ardından mevcut PR'a (veya yeni bir branch/PR'a) ekleyeyim.
