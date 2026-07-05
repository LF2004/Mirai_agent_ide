<script setup>
import { ref, watch, computed } from 'vue';
import { t } from '../utils/i18n.js';

const props = defineProps({
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
  },
  marketplaceResults: {
    type: Array,
    default: () => []
  },
  marketplaceLoading: {
    type: Boolean,
    default: false
  },
  marketplaceQuery: {
    type: String,
    default: ''
  },
  activeTab: {
    type: String,
    default: 'installed'
  },
  installingIds: {
    type: Object,
    default: () => ({})
  }
});

const emit = defineEmits([
  'update:query',
  'update:marketplace-query',
  'update:active-tab',
  'refresh',
  'toggle-enabled',
  'reveal-extension',
  'search-marketplace',
  'install-extension',
  'uninstall-extension',
  'get-extension-details'
]);

const localMarketplaceQuery = ref(props.marketplaceQuery);
const selectedMarketplaceExt = ref(null);
const detailLoading = ref(false);
const detailError = ref('');
let searchDebounce = null;

watch(() => props.marketplaceQuery, (val) => {
  localMarketplaceQuery.value = val;
});

function onMarketplaceInput(event) {
  const value = event.target.value;
  localMarketplaceQuery.value = value;
  emit('update:marketplace-query', value);

  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    if (value.trim()) {
      emit('search-marketplace', value);
    }
  }, 400);
}

function clearMarketplaceSearch() {
  localMarketplaceQuery.value = '';
  emit('update:marketplace-query', '');
  emit('search-marketplace', '');
}

function switchTab(tab) {
  emit('update:active-tab', tab);
  if (tab === 'marketplace' && !props.marketplaceResults.length && !props.marketplaceQuery) {
    emit('search-marketplace', '');
  }
}

function formatNumber(num) {
  if (!num) return '0';
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return String(num);
}

function getInstallStatus(extensionId) {
  return props.installingIds[extensionId] || '';
}

function isInstalling(extensionId) {
  const status = getInstallStatus(extensionId);
  return status === 'installing' || status === 'uninstalling';
}

function getExtensionId(ext) {
  return ext.extensionId || ext.id || '';
}

function handleInstall(ext) {
  const id = getExtensionId(ext);
  if (!id) return;
  emit('install-extension', id);
}

function handleUninstall(ext) {
  const id = getExtensionId(ext);
  if (!id) return;
  emit('uninstall-extension', id);
}

async function selectMarketplaceExtension(ext) {
  selectedMarketplaceExt.value = ext;
  detailLoading.value = true;
  detailError.value = '';
  // The parent will handle fetching details via get-extension-details event
  emit('get-extension-details', getExtensionId(ext));
}

function closeDetailPanel() {
  selectedMarketplaceExt.value = null;
}

// Expose for parent to update detail data
function updateDetailData(detail) {
  if (detail) {
    selectedMarketplaceExt.value = { ...selectedMarketplaceExt.value, ...detail };
  }
  detailLoading.value = false;
}

defineExpose({ updateDetailData, selectedMarketplaceExt });
</script>

<template>
  <div class="pane extensions-panel">
    <div class="pane__header pane__header--explorer">
      <span>{{ t('extensions').toUpperCase() }}</span>
      <div class="pane__header-actions">
        <button class="icon-button codicon codicon-refresh" :title="t('refresh')" @click="$emit('refresh')"></button>
      </div>
    </div>

    <!-- Tab switcher -->
    <div class="extensions-tabs">
      <button
        class="extensions-tab"
        :class="{ 'is-active': activeTab === 'installed' }"
        @click="switchTab('installed')"
      >
        {{ t('installed') }}
      </button>
      <button
        class="extensions-tab"
        :class="{ 'is-active': activeTab === 'marketplace' }"
        @click="switchTab('marketplace')"
      >
        {{ t('marketplace') }}
      </button>
    </div>

    <!-- Installed extensions tab -->
    <template v-if="activeTab === 'installed'">
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
            <div class="extension-card__title-row">
              <strong>{{ extension.name }}</strong>
              <span class="extension-card__version">v{{ extension.version }}</span>
            </div>
            <span class="tool-badge" :class="extension.enabled ? 'tool-badge--ready' : 'tool-badge--idle'">
              {{ extension.enabled ? t('enabled') : t('disabled') }}
            </span>
          </div>

          <p class="extension-card__description">{{ extension.description || t('noDescription') }}</p>

          <div class="extension-card__meta">
            <span class="codicon codicon-publisher"></span>
            <span>{{ extension.publisher || t('unknownPublisher') }}</span>
            <span class="extension-card__separator">·</span>
            <span>{{ extension.categories?.join(', ') || t('uncategorized') }}</span>
          </div>

          <div class="extension-card__contributes">
            <span class="ext-stat"><span class="codicon codicon-color-mode"></span> {{ extension.contributes?.themes || 0 }}</span>
            <span class="ext-stat"><span class="codicon codicon-code"></span> {{ extension.contributes?.grammars || 0 }}</span>
            <span class="ext-stat"><span class="codicon codicon-symbol-keyword"></span> {{ extension.contributes?.languages || 0 }}</span>
          </div>

          <div class="extension-card__actions">
            <button class="ghost-button" @click="$emit('reveal-extension', extension.path)">
              <span class="codicon codicon-folder-opened"></span>
              {{ t('revealExtension') }}
            </button>
            <button class="ghost-button" @click="$emit('toggle-enabled', extension)">
              {{ extension.enabled ? t('disable') : t('enable') }}
            </button>
            <button
              class="ghost-button ext-uninstall-btn"
              :disabled="isInstalling(extension.id)"
              @click="handleUninstall(extension)"
            >
              <span v-if="getInstallStatus(extension.id) === 'uninstalling'" class="codicon codicon-loading codicon-modifier-spin"></span>
              <span v-else class="codicon codicon-trash"></span>
              {{ t('uninstall') }}
            </button>
          </div>
        </article>
      </div>
    </template>

    <!-- Marketplace tab -->
    <template v-else>
      <div class="extensions-panel__search">
        <div class="search-input-row">
          <span class="codicon codicon-search"></span>
          <input
            class="search-input"
            v-model="localMarketplaceQuery"
            :placeholder="t('marketplaceSearchHint')"
            @input="onMarketplaceInput"
            @keydown.enter.prevent="$emit('search-marketplace', localMarketplaceQuery)"
          />
          <button
            v-if="localMarketplaceQuery"
            class="marketplace-clear-btn codicon codicon-close"
            @click="clearMarketplaceSearch"
          ></button>
        </div>
        <p class="pane__hint">{{ t('marketplaceHint') }}</p>
      </div>

      <div class="marketplace-layout">
        <!-- Marketplace search results list -->
        <div class="marketplace-list-pane">
          <div v-if="marketplaceLoading" class="marketplace-loading">
            <span class="codicon codicon-loading codicon-modifier-spin"></span>
            <span>{{ t('loadingExtensions') }}</span>
          </div>

          <div v-else-if="marketplaceResults.length === 0" class="pane__hint extensions-panel__empty">
            {{ t('noMarketplaceResults') }}
          </div>

          <article
            v-for="ext in marketplaceResults"
            :key="getExtensionId(ext)"
            class="marketplace-item"
            :class="{ 'is-selected': selectedMarketplaceExt && getExtensionId(selectedMarketplaceExt) === getExtensionId(ext) }"
            @click="selectMarketplaceExtension(ext)"
          >
            <div class="marketplace-item__icon">
              <img
                v-if="ext.iconUrl"
                :src="ext.iconUrl"
                :alt="ext.name"
                @error="$event.target.style.display = 'none'"
              />
              <span v-else class="codicon codicon-extensions"></span>
            </div>

            <div class="marketplace-item__body">
              <div class="marketplace-item__header">
                <strong class="marketplace-item__name">{{ ext.name }}</strong>
                <span class="marketplace-item__publisher">{{ ext.publisherDisplayName || ext.publisherName }}</span>
              </div>
              <p class="marketplace-item__desc">{{ ext.shortDescription || ext.description || t('noDescription') }}</p>
              <div class="marketplace-item__meta">
                <span v-if="ext.installs" class="marketplace-meta-item">
                  <span class="codicon codicon-download"></span>
                  {{ formatNumber(ext.installs) }} {{ t('downloads') }}
                </span>
                <span v-if="ext.averageRating" class="marketplace-meta-item">
                  <span class="codicon codicon-star-full"></span>
                  {{ ext.averageRating.toFixed(1) }}
                </span>
                <span v-if="ext.categories?.length" class="marketplace-meta-item">
                  {{ ext.categories[0] }}
                </span>
              </div>
            </div>

            <div class="marketplace-item__actions" @click.stop>
              <button
                v-if="ext.isInstalled"
                class="marketplace-installed-group"
              >
                <span class="marketplace-installed-badge">
                  <span class="codicon codicon-check"></span>
                  {{ t('installedBadge') }}
                </span>
                <button
                  class="marketplace-uninstall-btn"
                  :disabled="isInstalling(getExtensionId(ext))"
                  :title="t('uninstall')"
                  @click="handleUninstall(ext)"
                >
                  <span v-if="getInstallStatus(getExtensionId(ext)) === 'uninstalling'" class="codicon codicon-loading codicon-modifier-spin"></span>
                  <span v-else class="codicon codicon-trash"></span>
                </button>
              </button>
              <button
                v-else-if="getInstallStatus(getExtensionId(ext)) === 'installing'"
                class="primary-button is-loading"
                disabled
              >
                <span class="codicon codicon-loading codicon-modifier-spin"></span>
                {{ t('installing') }}
              </button>
              <button
                v-else-if="getInstallStatus(getExtensionId(ext)) === 'failed'"
                class="primary-button is-failed"
                @click="handleInstall(ext)"
              >
                <span class="codicon codicon-error"></span>
                {{ t('install') }}
              </button>
              <button
                v-else
                class="primary-button"
                @click="handleInstall(ext)"
              >
                {{ t('install') }}
              </button>
            </div>
          </article>
        </div>

        <!-- Detail preview panel -->
        <Transition name="detail-slide">
          <div v-if="selectedMarketplaceExt" class="marketplace-detail-pane">
            <div class="marketplace-detail__header">
              <div class="marketplace-detail__icon">
                <img
                  v-if="selectedMarketplaceExt.iconUrl"
                  :src="selectedMarketplaceExt.iconUrl"
                  :alt="selectedMarketplaceExt.name"
                  @error="$event.target.style.display = 'none'"
                />
                <span v-else class="codicon codicon-extensions"></span>
              </div>
              <div class="marketplace-detail__title-area">
                <h3 class="marketplace-detail__name">{{ selectedMarketplaceExt.name }}</h3>
                <div class="marketplace-detail__publisher">
                  <span class="codicon codicon-publisher"></span>
                  {{ selectedMarketplaceExt.publisherDisplayName || selectedMarketplaceExt.publisherName }}
                </div>
              </div>
              <button class="marketplace-detail__close codicon codicon-close" @click="closeDetailPanel"></button>
            </div>

            <div class="marketplace-detail__body">
              <!-- Stats row -->
              <div class="marketplace-detail__stats">
                <div v-if="selectedMarketplaceExt.installs" class="detail-stat">
                  <span class="codicon codicon-download"></span>
                  <div>
                    <strong>{{ formatNumber(selectedMarketplaceExt.installs) }}</strong>
                    <span>{{ t('downloads') }}</span>
                  </div>
                </div>
                <div v-if="selectedMarketplaceExt.averageRating" class="detail-stat">
                  <span class="codicon codicon-star-full"></span>
                  <div>
                    <strong>{{ selectedMarketplaceExt.averageRating.toFixed(1) }}</strong>
                    <span>{{ selectedMarketplaceExt.ratingCount || 0 }} {{ t('rating') }}</span>
                  </div>
                </div>
                <div class="detail-stat">
                  <span class="codicon codicon-versions"></span>
                  <div>
                    <strong>v{{ selectedMarketplaceExt.version }}</strong>
                    <span>{{ selectedMarketplaceExt.lastUpdated ? new Date(selectedMarketplaceExt.lastUpdated).toLocaleDateString() : '' }}</span>
                  </div>
                </div>
              </div>

              <!-- Categories & tags -->
              <div v-if="selectedMarketplaceExt.categories?.length" class="marketplace-detail__tags">
                <span v-for="cat in selectedMarketplaceExt.categories" :key="cat" class="detail-tag">{{ cat }}</span>
              </div>

              <!-- Description -->
              <div class="marketplace-detail__section">
                <h4 class="marketplace-detail__section-title">{{ t('description') || 'Description' }}</h4>
                <p class="marketplace-detail__desc">{{ selectedMarketplaceExt.shortDescription || selectedMarketplaceExt.description || t('noDescription') }}</p>
              </div>

              <!-- Repository -->
              <div v-if="selectedMarketplaceExt.repository?.url" class="marketplace-detail__section">
                <h4 class="marketplace-detail__section-title">{{ t('repository') || 'Repository' }}</h4>
                <a :href="selectedMarketplaceExt.repository.url" class="marketplace-detail__link" target="_blank">
                  <span class="codicon codicon-repo"></span>
                  {{ selectedMarketplaceExt.repository.url }}
                </a>
              </div>

              <!-- Action buttons -->
              <div class="marketplace-detail__actions">
                <button
                  v-if="selectedMarketplaceExt.isInstalled"
                  class="primary-button is-installed"
                  disabled
                >
                  <span class="codicon codicon-check"></span>
                  {{ t('installedBadge') }}
                </button>
                <button
                  v-else-if="getInstallStatus(getExtensionId(selectedMarketplaceExt)) === 'installing'"
                  class="primary-button is-loading"
                  disabled
                >
                  <span class="codicon codicon-loading codicon-modifier-spin"></span>
                  {{ t('installing') }}
                </button>
                <button
                  v-else
                  class="primary-button"
                  @click="handleInstall(selectedMarketplaceExt)"
                >
                  <span class="codicon codicon-cloud-download"></span>
                  {{ t('install') }}
                </button>

                <button
                  v-if="selectedMarketplaceExt.isInstalled"
                  class="ghost-button"
                  :disabled="isInstalling(getExtensionId(selectedMarketplaceExt))"
                  @click="handleUninstall(selectedMarketplaceExt)"
                >
                  <span v-if="getInstallStatus(getExtensionId(selectedMarketplaceExt)) === 'uninstalling'" class="codicon codicon-loading codicon-modifier-spin"></span>
                  <span v-else class="codicon codicon-trash"></span>
                  {{ t('uninstall') }}
                </button>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </template>
  </div>
</template>

<style scoped>
.extensions-tabs {
  display: flex;
  gap: 2px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel-alt);
}

.extensions-tab {
  height: 26px;
  padding: 0 12px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-soft);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.extensions-tab:hover {
  background: var(--bg-hover);
  color: var(--text-main);
}

.extensions-tab.is-active {
  background: var(--bg-active);
  color: var(--text-strong);
  font-weight: 600;
}

.marketplace-clear-btn {
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-soft);
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.marketplace-clear-btn:hover {
  background: var(--bg-hover);
  color: var(--text-main);
}

/* ===== Installed extensions cards ===== */

.extension-card__title-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.extension-card__version {
  color: var(--text-soft);
  font-size: 11px;
}

.extension-card__separator {
  color: var(--text-soft);
  opacity: 0.5;
}

.extension-card__meta {
  display: flex;
  align-items: center;
  gap: 4px;
}

.extension-card__meta .codicon {
  font-size: 13px;
}

.ext-stat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-soft);
}

.ext-stat .codicon {
  font-size: 13px;
}

.ext-uninstall-btn {
  color: var(--text-soft);
  margin-left: auto;
}

.ext-uninstall-btn:hover {
  color: #ff6b6b;
}

.ext-uninstall-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

/* ===== Marketplace layout ===== */

.marketplace-layout {
  flex: 1 1 auto;
  display: grid;
  grid-template-columns: 1fr 0fr;
  min-height: 0;
  overflow: hidden;
  transition: grid-template-columns 0.25s ease;
}

.marketplace-layout:has(.marketplace-detail-pane) {
  grid-template-columns: 1fr 300px;
}

.marketplace-list-pane {
  overflow-y: auto;
  min-height: 0;
}

.marketplace-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px 12px;
  color: var(--text-soft);
  font-size: 13px;
}

.marketplace-item {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.15s ease;
}

.marketplace-item:hover {
  background: var(--bg-hover);
}

.marketplace-item.is-selected {
  background: var(--bg-active);
  border-left: 3px solid var(--accent);
  padding-left: 9px;
}

.marketplace-item__icon {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  overflow: hidden;
  flex-shrink: 0;
}

.marketplace-item__icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.marketplace-item__icon .codicon {
  font-size: 24px;
  color: var(--text-soft);
}

.marketplace-item__body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.marketplace-item__header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.marketplace-item__name {
  color: var(--text-strong);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.marketplace-item__publisher {
  color: var(--text-soft);
  font-size: 11px;
  flex-shrink: 0;
}

.marketplace-item__desc {
  margin: 0;
  color: var(--text-soft);
  font-size: 12px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.marketplace-item__meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 4px;
  color: var(--text-soft);
  font-size: 11px;
}

.marketplace-meta-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.marketplace-meta-item .codicon {
  font-size: 12px;
}

.marketplace-item__actions {
  display: flex;
  align-items: flex-start;
  flex-shrink: 0;
}

.marketplace-item__actions .primary-button {
  min-width: 72px;
  height: 28px;
  font-size: 12px;
}

.marketplace-item__actions .primary-button.is-loading {
  opacity: 0.7;
  pointer-events: none;
}

.marketplace-installed-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.marketplace-installed-badge {
  min-width: 72px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border-strong);
  border-radius: 7px;
  background: transparent;
  color: var(--success);
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.marketplace-uninstall-btn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-strong);
  border-radius: 7px;
  background: transparent;
  color: var(--text-soft);
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s;
}

.marketplace-uninstall-btn:hover {
  color: #ff6b6b;
  border-color: #ff6b6b;
}

.marketplace-uninstall-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.primary-button.is-failed {
  border-color: var(--warning);
  color: var(--warning);
}

.primary-button.is-installed {
  background: transparent;
  border: 1px solid var(--success);
  color: var(--success);
  cursor: default;
}

/* ===== Detail panel ===== */

.marketplace-detail-pane {
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border);
  background: var(--bg-panel);
  overflow: hidden;
  min-width: 0;
}

.marketplace-detail__header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel-alt);
}

.marketplace-detail__icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  overflow: hidden;
  flex-shrink: 0;
}

.marketplace-detail__icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.marketplace-detail__icon .codicon {
  font-size: 20px;
  color: var(--text-soft);
}

.marketplace-detail__title-area {
  flex: 1 1 auto;
  min-width: 0;
}

.marketplace-detail__name {
  margin: 0 0 4px;
  font-size: 14px;
  color: var(--text-strong);
  word-break: break-word;
}

.marketplace-detail__publisher {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-soft);
  font-size: 12px;
}

.marketplace-detail__close {
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-soft);
  font-size: 14px;
  cursor: pointer;
  flex-shrink: 0;
}

.marketplace-detail__close:hover {
  background: var(--bg-hover);
  color: var(--text-main);
}

.marketplace-detail__body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.marketplace-detail__stats {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.detail-stat {
  display: flex;
  align-items: center;
  gap: 6px;
}

.detail-stat .codicon {
  font-size: 16px;
  color: var(--accent);
}

.detail-stat div {
  display: flex;
  flex-direction: column;
}

.detail-stat strong {
  font-size: 13px;
  color: var(--text-strong);
}

.detail-stat span {
  font-size: 10px;
  color: var(--text-soft);
}

.marketplace-detail__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.detail-tag {
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--bg-active);
  color: var(--text-main);
  font-size: 11px;
}

.marketplace-detail__section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.marketplace-detail__section-title {
  margin: 0;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-soft);
}

.marketplace-detail__desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-main);
}

.marketplace-detail__link {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--accent);
  font-size: 12px;
  text-decoration: none;
  word-break: break-all;
}

.marketplace-detail__link:hover {
  text-decoration: underline;
}

.marketplace-detail__actions {
  display: flex;
  gap: 8px;
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.marketplace-detail__actions .primary-button,
.marketplace-detail__actions .ghost-button {
  flex: 1 1 auto;
  height: 32px;
}

/* ===== Slide transition ===== */

.detail-slide-enter-active,
.detail-slide-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.detail-slide-enter-from,
.detail-slide-leave-to {
  opacity: 0;
  transform: translateX(20px);
}

/* ===== Responsive ===== */

@media (max-width: 600px) {
  .marketplace-layout:has(.marketplace-detail-pane) {
    grid-template-columns: 1fr;
  }
  .marketplace-detail-pane {
    position: absolute;
    inset: 0;
    z-index: 10;
  }
}
</style>
