---
title: "Документы ИТД — itd.legal"
description: "Действующие документы ИТД, история редакций и полный текст выбранной версии."
---

# Документы — `itd.legal`

Методы доступны в полном и REST-клиенте без авторизации.

| Метод | Результат |
|---|---|
| `list(scope?)` | Список документов и сведения об их действующих редакциях. По умолчанию область `social`. |
| `current(scope, slug)` | Действующая редакция с полным текстом. |
| `versions(scope, slug)` | История редакций без текста. Поле `current` отмечает действующую редакцию. |
| `version(scope, slug, version)` | Выбранная редакция с полным текстом. |

Полный текст возвращается в `blocks` в порядке чтения. Дата публикации `publishedAt`
может быть `null`. Если документ или редакция отсутствуют, SDK выбрасывает `ItdNotFoundError`.

```ts
import { LegalDocumentScope } from 'itd-api';

const scope = LegalDocumentScope.Social;
const terms = await itd.legal.current(scope, 'terms');
const editions = await itd.legal.versions(scope, 'terms');
const previous = editions.find((edition) => !edition.current);

if (previous) {
  const document = await itd.legal.version(scope, 'terms', previous.version);
  console.log(document.blocks);
}
```
