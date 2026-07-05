<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';

const props = defineProps({
  items: {
    type: Array,
    default: () => []
  },
  x: {
    type: Number,
    default: 0
  },
  y: {
    type: Number,
    default: 0
  }
});

const emit = defineEmits(['close', 'select']);

const menuRef = ref(null);

function handleItemClick(item) {
  if (item.disabled || item.separator) return;
  emit('select', item);
  emit('close');
}

function handleGlobalClick(event) {
  if (menuRef.value && !menuRef.value.contains(event.target)) {
    emit('close');
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', handleGlobalClick, { capture: true });
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleGlobalClick, { capture: true });
});
</script>

<template>
  <div
    ref="menuRef"
    class="context-menu ide-context-menu"
    :style="{ left: `${x}px`, top: `${y}px` }"
  >
    <template v-for="(item, index) in items" :key="item.id || `item-${index}`">
      <div v-if="item.separator" class="context-menu__separator"></div>
      <button
        v-else
        class="context-menu__item"
        :class="{ 'is-disabled': item.disabled, 'is-danger': item.danger, 'is-checked': item.checked }"
        :disabled="item.disabled"
        @click="handleItemClick(item)"
      >
        <span class="context-menu__icon">
          <span v-if="item.icon" :class="item.icon"></span>
          <span v-else-if="item.checked" class="codicon codicon-check"></span>
        </span>
        <span class="context-menu__label">{{ item.label }}</span>
        <span v-if="item.shortcut" class="context-menu__shortcut">{{ item.shortcut }}</span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.ide-context-menu {
  min-width: 200px;
  max-width: 320px;
  padding: 4px 0;
  border-radius: 6px;
  z-index: 1000;
}

.context-menu__separator {
  height: 1px;
  margin: 4px 0;
  background: var(--border);
}

.context-menu__item {
  display: grid;
  grid-template-columns: 20px 1fr auto;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 28px;
  padding: 0 12px 0 8px;
  border: 0;
  background: transparent;
  color: var(--text-main);
  text-align: left;
  font-size: 12px;
  white-space: nowrap;
  border-radius: 0;
}

.context-menu__item:hover:not(.is-disabled) {
  background: var(--accent);
  color: #ffffff;
}

.context-menu__item.is-disabled {
  color: var(--text-soft);
  opacity: 0.5;
  cursor: default;
}

.context-menu__item.is-disabled:hover {
  background: transparent;
}

.context-menu__item.is-danger {
  color: #ff6b6b;
}

.context-menu__item.is-danger:hover {
  background: #7f1d1d;
  color: #ffffff;
}

.context-menu__icon {
  width: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
}

.context-menu__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-menu__shortcut {
  color: var(--text-soft);
  font-size: 11px;
}

.context-menu__item:hover:not(.is-disabled) .context-menu__shortcut {
  color: rgba(255, 255, 255, 0.8);
}
</style>
