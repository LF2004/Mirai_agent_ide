<script setup>
import { computed, ref, watch } from 'vue';
import { t } from '../utils/i18n.js';

const props = defineProps({
  workspacePath: {
    type: String,
    default: ''
  },
  searchState: {
    type: Object,
    required: true
  },
  resultsCount: {
    type: Number,
    default: 0
  }
});

const emit = defineEmits(['run-search', 'run-replace', 'undo-last', 'select-result']);

const localQuery = ref('');
const localReplace = ref('');
const localInclude = ref('');
const localExclude = ref('');
const replaceExpanded = ref(false);

const groupedResults = computed(() => {
  const groups = new Map();
  for (const result of props.searchState.results || []) {
    if (!groups.has(result.path)) {
      groups.set(result.path, []);
    }
    groups.get(result.path).push(result);
  }

  return Array.from(groups.entries()).map(([path, matches]) => ({
    path,
    matches
  }));
});

function syncFromProps() {
  localQuery.value = props.searchState.query || '';
  localReplace.value = props.searchState.replace || '';
  localInclude.value = props.searchState.includeFiles || '';
  localExclude.value = props.searchState.excludeFiles || '';
  replaceExpanded.value = Boolean(props.searchState.replaceExpanded);
}

function submitSearch() {
  emit('run-search', {
    query: localQuery.value,
    replace: localReplace.value,
    includeFiles: localInclude.value,
    excludeFiles: localExclude.value,
    replaceExpanded: replaceExpanded.value
  });
}

function submitReplace() {
  emit('run-replace', {
    query: localQuery.value,
    replace: localReplace.value,
    includeFiles: localInclude.value,
    excludeFiles: localExclude.value,
    replaceExpanded: true
  });
}

function onKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    submitSearch();
  }

  if (event.key === 'Enter' && event.ctrlKey) {
    event.preventDefault();
    submitReplace();
  }
}

watch(() => props.searchState, syncFromProps, { deep: true, immediate: true });
</script>

<template>
  <div class="pane search-panel">
    <div class="pane__header pane__header--explorer">
      <span>{{ t('search').toUpperCase() }}</span>
      <div class="pane__header-actions">
        <button class="icon-button codicon codicon-refresh" :title="t('runSearch')" @click="submitSearch"></button>
        <button
          class="icon-button codicon"
          :class="replaceExpanded ? 'codicon-chevron-up' : 'codicon-chevron-down'"
          :title="t('replaceInFiles')"
          @click="replaceExpanded = !replaceExpanded"
        ></button>
      </div>
    </div>

    <div class="search-form" @keydown="onKeydown">
      <div class="search-input-row">
        <span class="codicon codicon-search"></span>
        <input v-model="localQuery" class="search-input" :placeholder="t('searchPlaceholder')" />
      </div>

      <div v-if="replaceExpanded" class="search-input-row">
        <span class="codicon codicon-replace"></span>
        <input v-model="localReplace" class="search-input" :placeholder="t('replacePlaceholder')" />
      </div>

      <div class="search-meta-grid">
        <label class="search-meta-field">
          <span>{{ t('includeFiles') }}</span>
          <input v-model="localInclude" class="settings-input" />
        </label>
        <label class="search-meta-field">
          <span>{{ t('excludeFiles') }}</span>
          <input v-model="localExclude" class="settings-input" />
        </label>
      </div>

      <div class="search-toolbar">
        <button class="primary-button" type="button" @click="submitSearch">{{ t('runSearch') }}</button>
        <button class="ghost-button" type="button" :disabled="!replaceExpanded" @click="submitReplace">{{ t('runReplace') }}</button>
        <button class="ghost-button" type="button" @click="$emit('undo-last')">{{ t('undoLastAction') }}</button>
      </div>
    </div>

    <div class="search-results">
      <div class="search-results__summary">
        <strong>{{ t('searchResults') }}</strong>
        <span>{{ resultsCount }}</span>
      </div>

      <div v-if="!workspacePath" class="pane__hint search-results__empty">{{ t('openOrCreateProject') }}</div>
      <div v-else-if="groupedResults.length === 0" class="pane__hint search-results__empty">{{ t('noSearchResults') }}</div>

      <section v-for="group in groupedResults" :key="group.path" class="search-file-group">
        <header class="search-file-group__header">
          <span class="codicon codicon-file"></span>
          <strong>{{ group.path }}</strong>
          <span>{{ group.matches.length }}</span>
        </header>

        <button
          v-for="match in group.matches"
          :key="`${group.path}:${match.lineNumber}:${match.preview}`"
          class="search-match"
          @click="$emit('select-result', match)"
        >
          <span class="search-match__line">{{ match.lineNumber }}</span>
          <span class="search-match__preview">{{ match.preview }}</span>
        </button>
      </section>
    </div>
  </div>
</template>
