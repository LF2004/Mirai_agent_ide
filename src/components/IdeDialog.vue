<script setup>
import { computed } from 'vue';

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  type: {
    type: String,
    default: 'alert' // 'alert' | 'confirm'
  },
  title: {
    type: String,
    default: ''
  },
  message: {
    type: String,
    default: ''
  }
});

const emit = defineEmits(['confirm', 'cancel', 'close']);

const isConfirm = computed(() => props.type === 'confirm');

function handleConfirm() {
  emit('confirm');
}

function handleCancel() {
  emit('cancel');
}

function handleBackdrop() {
  // Backdrop click acts as cancel for confirm, close for alert
  if (isConfirm.value) {
    emit('cancel');
  } else {
    emit('close');
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="ide-dialog-fade">
      <div v-if="visible" class="ide-dialog-overlay" @click.self="handleBackdrop">
        <div class="ide-dialog" role="dialog" aria-modal="true">
          <div class="ide-dialog__header">
            <span class="ide-dialog__title">{{ title }}</span>
            <button class="ide-dialog__close codicon codicon-close" @click="handleCancel"></button>
          </div>
          <div class="ide-dialog__body">
            <span class="ide-dialog__icon codicon" :class="isConfirm ? 'codicon-question' : 'codicon-info'"></span>
            <p class="ide-dialog__message">{{ message }}</p>
          </div>
          <div class="ide-dialog__footer">
            <button v-if="isConfirm" class="ghost-button" @click="handleCancel">取消</button>
            <button class="primary-button" :class="{ 'danger-button': isConfirm }" @click="handleConfirm">
              {{ isConfirm ? '确定' : '确定' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
