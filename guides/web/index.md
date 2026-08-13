---
layout: home
title: itd-api — TypeScript SDK для итд.com
titleTemplate: false

hero:
  name: itd-api
  text: Полный SDK без лишней магии
  tagline: Типобезопасная работа с API итд.com в Node.js, браузере, Bun, Deno и React Native.
  image:
    light: /logos/itd-api-logo-light.svg
    dark: /logos/itd-api-logo.svg
    alt: itd-api
  actions:
    - theme: brand
      text: Начать работу
      link: /quickstart/
    - theme: alt
      text: Открыть справочник
      link: /reference/
    - theme: alt
      text: API из TSDoc
      link: /api/

features:
  - icon: SDK
    title: Один клиент
    details: Пользователи, посты, комментарии, уведомления, файлы, подписка и остальные ресурсы доступны через единый ItdClient.
    link: /reference/client
    linkText: Возможности клиента
  - icon: TS
    title: TypeScript прежде всего
    details: Публичные модели, параметры, ошибки и результаты типизированы, а точные сигнатуры собираются прямо из исходного кода.
    link: /api/
    linkText: Открыть API
  - icon: RT
    title: Сессии и события
    details: Обновление токенов, хранилища, несколько аккаунтов, SSE, polling и восстановление соединения уже встроены.
    link: /events/
    linkText: Настроить события
  - icon: +
    title: Расширяемая архитектура
    details: Подключайте cache, hydrate, crypto, proxy и Turnstile или создавайте собственные расширения поверх публичного API.
    link: /packages/
    linkText: Посмотреть пакеты
---

<div class="docs-home">
  <section class="quick-panel">
    <div class="quick-copy">
      <div class="section-kicker">Первый запрос</div>
      <h2>От установки до данных — несколько строк</h2>
      <p>
        Создайте клиент с токеном и весь API в вашем распоряжении.
      </p>
      <p><a href="./quickstart/">Перейти к быстрому старту →</a></p>
    </div>
    <div class="quick-code" aria-label="Пример использования itd-api">
      <div class="quick-code-bar"><span></span><span></span><span></span></div>
      <pre v-pre><code>import { ItdClient } from 'itd-api';
const itd = new ItdClient({ auth: process.env.ITD_TOKEN });
const me = await itd.users.me();
console.log(`@${me.username}: ${me.followersCount}`);</code></pre>
    </div>
  </section>

  <section>
    <div class="section-kicker">Экосистема</div>
    <h2>Подключайте только нужные возможности</h2>
    <p class="docs-home-lead">
      Основной пакет остаётся универсальным клиентом, а дополнительные сценарии
      вынесены в небольшие самостоятельные пакеты.
    </p>
    <div class="package-grid">
      <a class="package-card" href="./packages/turnstile">
        <code>@itd-api/turnstile</code>
        <p>Токен капчи для входа по логину и паролю — через локальный браузер.</p>
      </a>
      <a class="package-card" href="./packages/proxy">
        <code>@itd-api/proxy</code>
        <p>HTTP и WebSocket через HTTP, HTTPS и SOCKS5-прокси.</p>
      </a>
      <a class="package-card" href="./packages/cache">
        <code>@itd-api/cache</code>
        <p>TTL/LRU-кэш и дедупликация одинаковых запросов.</p>
      </a>
      <a class="package-card" href="./packages/hydrate">
        <code>@itd-api/hydrate</code>
        <p>Методы действий прямо на моделях API: пост, комментарий, профиль.</p>
      </a>
      <a class="package-card" href="./packages/crypto">
        <code>@itd-api/crypto</code>
        <p>Скрытые сообщения и шифрование содержимого через плагин.</p>
      </a>
      <a class="package-card" href="./packages/testing">
        <code>@itd-api/testing</code>
        <p>Сценарные ответы, сервер API в памяти и управляемые события.</p>
      </a>
    </div>
  </section>
</div>
