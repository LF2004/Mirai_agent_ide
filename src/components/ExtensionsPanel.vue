<script setup>
import { t } from '../utils/i18n.js';

defineProps({
  extensions: {
    type: Array,
    default: () => []
  },
  loading: {
    type: Boolean,
    default: false
  },
  query: {
    type: String,
    default: ''
  }
});

defineEmits(['update:query', 'refresh', 'toggle-enabled', 'reveal-extension']);
</script>

<template>
  <div class="pane extensions-panel">
    <div class="pane__header pane__header--explorer">
      <span>{{ t('extensions').toUpperCase() }}</span>
      <div class="pane__header-actions">
        <button class="icon-button codicon codicon-refresh" :title="t('refresh')" @click="$emit('refresh')"></button>
      </div>
    </div>

    <div class="extensions-panel__search">
      <div class="search-input-row">
        <span class="codicon codicon-extensions"></span>
        <input
          class="search-input"
          :value="query"
          :placeholder="t('searchExtensions')"
          @input="$emit('update:query', $event.target.value)"
        />
      </div>
      <p class="pane__hint">{{ t('extensionsHint') }}</p>
    </div>

    <div class="extensions-panel__list">
      <div v-if="loading" class="pane__hint extensions-panel__empty">{{ t('loadingExtensions') }}</div>
      <div v-else-if="extensions.length === 0" class="pane__hint extensions-panel__empty">{{ t('noExtensionsFound') }}</div>

      <article v-for="extension in extensions" :key="extension.id" class="extension-card">
        <div class="extension-card__top">
          <div>
            <strong>{{ extension.name }}</strong>
            <p>{{ extension.id }}</p>
          </div>
          <span class="tool-badge" :class="extension.enabled ? 'tool-badge--ready' : 'tool-badge--idle'">
            {{ extension.enabled ? t('enabled') : t('disabled') }}
          </span>
        </div>

        <p class="extension-card__description">{{ extension.description || t('noDescription') }}</p>

        <div class="extension-card__meta">
          <span>{{ extension.publisher || t('unknownPublisher') }}</span>
          <span>v{{ extension.version }}</span>
          <span>{{ extension.categories?.join(', ') || t('uncategorized') }}</span>
        </div>

        <div class="extension-card__contributes">
          <span>{{ t('themesCount') }} {{ extension.contributes?.themes || 0 }}</span>
          <span>{{ t('grammarsCount') }} {{ extension.contributes?.grammars || 0 }}</span>
          <span>{{ t('languagesCount') }} {{ extension.contributes?.languages || 0 }}</span>
        </div>

        <div class="extension-card__actions">
          <button class="ghost-button" @click="$emit('reveal-extension', extension.path)">{{ t('revealExtension') }}</button>
          <button class="primary-button" @click="$emit('toggle-enabled', extension)">
            {{ extension.enabled ? t('disable') : t('enable') }}
          </button>
        </div>
      </article>
    </div>
  </div>
</template>
