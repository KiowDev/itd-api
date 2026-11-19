<script setup lang="ts">
import { useData } from 'vitepress';
import { computed, nextTick, onBeforeUnmount, reactive, ref, shallowRef } from 'vue';
import { deepWikiQuestions } from './questions';

interface Exchange {
  question: string;
  answer?: string;
  error?: string;
}

const { page } = useData();
const isOpen = ref(false);
const draft = ref('');
const exchanges = ref<Exchange[]>([]);
const request = shallowRef<AbortController>();
const launcher = ref<HTMLButtonElement>();
const panel = ref<HTMLElement>();
const feed = ref<HTMLElement>();
const field = ref<HTMLTextAreaElement>();

/** Обновляет подсказку вместе со страницей и исключает последний отправленный пример. */
const suggestions = computed(() => {
  const { relativePath, title } = page.value;
  const path = relativePath.replace(/\/index\.md$/, '').replace(/\.md$/, '');
  const topic = title.replace(/^(Class|Interface|Function|Variable|Type Alias|Enumeration):\s*/, '');
  const questions = deepWikiQuestions[path] ?? [
    `Покажи пример использования «${topic}» в TypeScript.`,
  ];
  const last = exchanges.value.at(-1);
  return last && !last.error ? questions.filter((question) => question !== last.question) : questions;
});

/** Удерживает поле ввода в видимой области при открытии клавиатуры. */
function syncViewport() {
  const viewport = window.visualViewport;
  if (!viewport || !panel.value) return;
  panel.value.style.setProperty('--deepwiki-viewport-top', `${viewport.offsetTop}px`);
  panel.value.style.setProperty('--deepwiki-viewport-height', `${viewport.height}px`);
}

/** Отключает слежение за видимой областью после закрытия панели. */
function stopTrackingViewport() {
  window.visualViewport?.removeEventListener('resize', syncViewport);
  window.visualViewport?.removeEventListener('scroll', syncViewport);
}

/** Переключает панель и возвращает фокус на кнопку при закрытии. */
async function toggle() {
  isOpen.value = !isOpen.value;
  await nextTick();
  if (isOpen.value) {
    syncViewport();
    window.visualViewport?.addEventListener('resize', syncViewport);
    window.visualViewport?.addEventListener('scroll', syncViewport);
    const target = window.matchMedia('(min-width: 768px) and (pointer: fine)').matches
      ? field.value
      : panel.value;
    target?.focus();
  } else {
    stopTrackingViewport();
    launcher.value?.focus();
  }
}

/** Подставляет пример в поле, сохраняя возможность изменить его перед отправкой. */
function chooseQuestion(question: string) {
  draft.value = question;
  field.value?.focus();
}

/** Добавляет вопрос и оставляет начало ответа видимым после загрузки. */
async function submit() {
  const question = draft.value.trim();
  if (!question || request.value) return;

  const controller = new AbortController();
  request.value = controller;
  const timeout = window.setTimeout(() => controller.abort(), 45_000);
  const exchange = reactive<Exchange>({ question });
  exchanges.value.push(exchange);
  draft.value = '';

  try {
    await nextTick();
    if (feed.value) feed.value.scrollTop = feed.value.scrollHeight;
    const { askDeepWiki } = await import('./client');
    exchange.answer = await askDeepWiki(question, controller.signal);
  } catch (error) {
    if (request.value !== controller) return;
    if (controller.signal.aborted) {
      exchange.error = 'DeepWiki не успел ответить. Попробуйте ещё раз.';
    } else if (error instanceof Error && error.name === 'Error') {
      exchange.error = error.message;
    } else {
      exchange.error = 'Не удалось получить ответ DeepWiki. Попробуйте ещё раз.';
    }
  } finally {
    window.clearTimeout(timeout);
    if (request.value === controller) request.value = undefined;
  }
}

/** Enter отправляет вопрос, Shift+Enter добавляет новую строку. */
function onEnter(event: KeyboardEvent) {
  if (event.isComposing) return;
  event.preventDefault();
  void submit();
}

onBeforeUnmount(() => {
  request.value?.abort();
  request.value = undefined;
  stopTrackingViewport();
});
</script>

<template>
  <div class="assistant" :class="{ 'deepwiki-open': isOpen }" @keydown.esc="isOpen && toggle()">
    <Transition name="assistant-panel">
      <section
        v-show="isOpen"
        id="deepwiki-panel"
        ref="panel"
        class="panel"
        role="dialog"
        aria-labelledby="deepwiki-title"
        tabindex="-1"
      >
        <header class="panel-header">
          <span class="mark" aria-hidden="true"><span class="bubble"></span></span>
          <div class="heading">
            <h2 id="deepwiki-title">DeepWiki</h2>
            <a href="https://deepwiki.com/KiowDev/itd-api" target="_blank" rel="noopener noreferrer">
              KiowDev/itd-api <span aria-hidden="true">↗</span>
            </a>
          </div>
          <button class="close" type="button" aria-label="Закрыть DeepWiki" @click="toggle">
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div ref="feed" class="feed" role="log" aria-label="Вопросы и ответы">
          <p v-if="exchanges.length === 0" class="empty">Спросите о возможностях SDK или его коде.</p>
          <div v-for="(exchange, index) in exchanges" :key="index" class="exchange">
            <p class="question">{{ exchange.question }}</p>
            <p v-if="exchange.error" class="error">{{ exchange.error }}</p>
            <div v-else-if="exchange.answer" class="reply" v-html="exchange.answer"></div>
            <p v-else class="pending">DeepWiki готовит ответ…</p>
          </div>
        </div>

        <form class="composer" @submit.prevent="submit">
          <div v-if="suggestions.length" class="suggestions">
            <button
              v-for="question in suggestions"
              :key="question"
              type="button"
              @click="chooseQuestion(question)"
            >
              {{ question }}
            </button>
          </div>
          <div class="input">
            <textarea
              ref="field"
              v-model="draft"
              rows="2"
              aria-label="Вопрос к DeepWiki"
              placeholder="Задайте вопрос об itd-api"
              @keydown.enter.exact="onEnter"
            ></textarea>
            <button
              class="send"
              type="submit"
              aria-label="Отправить вопрос"
              :disabled="!draft.trim() || !!request"
            >
              <span aria-hidden="true">↑</span>
            </button>
          </div>
          <p class="hint">Вопросы отправляются в DeepWiki.</p>
        </form>
      </section>
    </Transition>

    <button
      ref="launcher"
      class="launcher"
      type="button"
      :aria-expanded="isOpen"
      aria-controls="deepwiki-panel"
      @click="toggle"
    >
      <span class="bubble" aria-hidden="true"></span>
      Спросить DeepWiki
    </button>
  </div>
</template>

<style scoped>
.assistant {
  position: fixed;
  z-index: 25;
  right: max(24px, env(safe-area-inset-right));
  bottom: max(24px, env(safe-area-inset-bottom));
  display: grid;
  justify-items: end;
  color: var(--vp-c-text-1);
  font-size: 14px;
  line-height: 1.5;
}

.launcher {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: var(--vp-c-bg-elv);
  box-shadow: var(--itd-shadow-resting);
  color: var(--vp-c-text-1);
  font-weight: 600;
  white-space: nowrap;
  transition: background var(--itd-duration) var(--itd-ease);
}

.launcher:hover,
.launcher[aria-expanded='true'] {
  background: var(--itd-block-hover-bg);
}

.bubble {
  position: relative;
  display: inline-block;
  width: 16px;
  height: 13px;
  flex: none;
  border: 1.5px solid currentColor;
  border-radius: 5px;
  color: var(--vp-c-brand-1);
}

.bubble::before,
.bubble::after {
  position: absolute;
  content: '';
}

.bubble::before {
  top: 4px;
  left: 3px;
  width: 2px;
  height: 2px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 4px 0 currentColor, 8px 0 currentColor;
}

.bubble::after {
  bottom: -4px;
  left: 3px;
  width: 5px;
  height: 5px;
  border-left: 1.5px solid currentColor;
  transform: skewY(-35deg);
}

.panel {
  position: absolute;
  right: 0;
  bottom: calc(100% + 12px);
  display: flex;
  width: min(424px, calc(100vw - 48px));
  max-height: min(640px, calc(100dvh - 110px));
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  border-radius: 20px;
  background: var(--vp-c-bg-elv);
  box-shadow: var(--itd-shadow-elevated), var(--itd-shadow-resting);
  transform-origin: bottom right;
}

.panel-header,
.composer {
  flex: none;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--vp-c-divider);
  background: linear-gradient(105deg, var(--vp-c-brand-soft), transparent 72%);
}

.mark {
  display: grid;
  width: 40px;
  height: 40px;
  flex: none;
  place-items: center;
  border-radius: 12px;
  background: var(--vp-c-brand-soft);
}

.heading {
  flex: 1;
}

.heading h2 {
  font-size: 15px;
  font-weight: 650;
}

.heading a,
.hint,
.pending {
  color: var(--vp-c-text-2);
  font-size: 12px;
}

.heading a:hover {
  text-decoration: underline;
}

.close,
.send {
  display: grid;
  flex: none;
  place-items: center;
  border-radius: 10px;
}

.close {
  width: 36px;
  height: 36px;
  color: var(--vp-c-text-1);
  font-size: 23px;
  line-height: 1;
}

.close:hover {
  background: var(--itd-bg-hover);
}

.feed {
  min-height: 0;
  padding: 16px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.suggestions button {
  padding: 6px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 9px;
  font-size: 13px;
  overflow-wrap: anywhere;
  text-align: left;
}

.suggestions button:hover {
  background: var(--itd-block-hover-bg);
}

.exchange + .exchange {
  margin-top: 18px;
}

.question {
  width: fit-content;
  max-width: 92%;
  margin: 0 0 12px auto;
  padding: 8px 12px;
  border-radius: 12px 12px 4px 12px;
  background: var(--vp-c-brand-soft);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.reply {
  overflow-wrap: anywhere;
}

.reply :deep(p + p),
.reply :deep(ul),
.reply :deep(ol),
.reply :deep(pre),
.reply :deep(h2),
.reply :deep(h3) {
  margin-top: 10px;
}

.reply :deep(ul),
.reply :deep(ol) {
  padding-left: 20px;
}

.reply :deep(ul) {
  list-style: disc;
}

.reply :deep(ol) {
  list-style: decimal;
}

.reply :deep(a) {
  color: var(--vp-c-brand-2);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.reply :deep(.citation) {
  display: inline-block;
  margin: 0 2px;
  padding: 0 4px;
  border-radius: 4px;
  background: var(--vp-c-brand-soft);
  font-size: 0.8em;
  font-weight: 600;
  text-decoration: none;
}

.reply :deep(.citation:hover) {
  text-decoration: underline;
}

.reply :deep(code) {
  background: var(--vp-code-block-bg);
  font-family: var(--vp-font-family-mono);
  font-size: 0.88em;
}

.reply :deep(:not(pre) > code) {
  padding: 2px 4px;
  border-radius: 4px;
}

.reply :deep(pre) {
  padding: 10px 12px;
  overflow-x: auto;
  border-radius: 9px;
  background: var(--vp-code-block-bg);
  white-space: pre;
}

.composer {
  padding: 12px 16px;
  border-top: 1px solid var(--vp-c-divider);
}

.input {
  display: flex;
  align-items: end;
  gap: 6px;
  padding: 5px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 13px;
  background: var(--itd-bg-primary);
}

.input:focus-within {
  border-color: var(--vp-c-brand-1);
}

.input textarea {
  width: 100%;
  min-width: 0;
  padding: 6px 7px;
  outline: none;
  background: transparent;
  color: inherit;
  font: inherit;
  resize: none;
}

.send {
  width: 34px;
  height: 34px;
  background: var(--vp-c-brand-1);
  color: var(--vp-button-brand-text);
  font-size: 20px;
  font-weight: 600;
  line-height: 1;
}

.send:disabled {
  background: var(--itd-bg-hover);
  color: var(--vp-c-text-2);
  cursor: default;
}

.hint {
  margin-top: 6px;
}

.error {
  color: var(--vp-c-danger-1);
}

.assistant button:focus-visible,
.assistant a:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

.assistant-panel-enter-active,
.assistant-panel-leave-active {
  transition: opacity var(--itd-duration) var(--itd-ease),
    transform var(--itd-duration) var(--itd-ease);
}

.assistant-panel-enter-from,
.assistant-panel-leave-to {
  opacity: 0;
  transform: translateY(5px) scale(0.985);
}

@media (max-width: 767px), (pointer: coarse) and (max-width: 960px) {
  :global(html:has(.deepwiki-open)) {
    overflow: hidden;
  }

  .assistant {
    right: max(12px, env(safe-area-inset-right));
    bottom: max(12px, env(safe-area-inset-bottom));
  }

  .deepwiki-open {
    z-index: 100;
  }

  .deepwiki-open .launcher {
    visibility: hidden;
  }

  .panel {
    position: fixed;
    inset: var(--deepwiki-viewport-top, 0px) 0 auto;
    width: auto;
    height: var(--deepwiki-viewport-height, 100dvh);
    max-height: none;
    padding-inline: env(safe-area-inset-left) env(safe-area-inset-right);
    border: 0;
    border-radius: 0;
    container-type: size;
  }

  .panel-header {
    padding-top: calc(14px + env(safe-area-inset-top));
  }

  .feed {
    flex: 1;
  }

  .feed:has(.empty) {
    display: grid;
    place-items: center;
    text-align: center;
  }

  .composer {
    padding-bottom: calc(12px + env(safe-area-inset-bottom));
  }

  .assistant-panel-enter-from,
  .assistant-panel-leave-to {
    transform: translateY(16px);
  }

  @container (max-height: 400px) {
    .suggestions {
      flex-wrap: nowrap;
      overflow-x: auto;
      overscroll-behavior-inline: contain;
      scrollbar-width: thin;
    }

    .suggestions button {
      max-width: 100%;
      flex: none;
    }
  }

  .input textarea {
    font-size: 16px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .launcher,
  .assistant-panel-enter-active,
  .assistant-panel-leave-active {
    transition: none;
  }
}
</style>
