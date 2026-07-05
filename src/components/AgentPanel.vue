<script setup>
import { ref } from 'vue';
import { t } from '../utils/i18n.js';

defineProps({
  mode: {
    type: String,
    default: 'agent'
  },
  model: {
    type: String,
    default: 'gpt-4.1'
  },
  currentFile: {
    type: String,
    default: ''
  },
  collapsed: {
    type: Boolean,
    default: false
  }
});

defineEmits(['mode-change', 'model-change', 'toggle-collapse']);

const input = ref('');
const messages = ref([
  {
    role: 'assistant',
    title: 'Workspace Ready',
    content: 'Open a file, edit it, then use this panel for planning and agent actions.'
  },
  {
    role: 'assistant',
    title: 'Current Context',
    content: 'This panel stays collapsible so the editor remains the main focus.'
  }
]);

function sendDraft() {
  const value = input.value.trim();

  if (!value) {
    return;
  }

  messages.value.push({
    role: 'user',
    title: 'You',
    content: value
  });

  messages.value.push({
    role: 'assistant',
    title: 'Agent',
    content: `Received: "${value}".`
  });

  input.value = '';
}
</script>

<template>
  <div class="panel agent-panel" :class="{ 'is-collapsed': collapsed }">
    <div class="agent-header">
      <div class="agent-header__title">
        <span class="codicon codicon-comment-discussion"></span>
        <div class="agent-header__text">
          <strong>{{ t('agent') }}</strong>
          <span>{{ currentFile || t('noFileSelected') }}</span>
        </div>
      </div>
      <div class="agent-header__actions">
        <button class="icon-button codicon codicon-add" :title="t('newChat')"></button>
        <button class="icon-button codicon codicon-history" :title="t('history')"></button>
        <button class="icon-button codicon codicon-ellipsis" :title="t('more')"></button>
        <button
          class="icon-button codicon"
          :class="collapsed ? 'codicon-chevron-left' : 'codicon-chevron-right'"
          :title="collapsed ? t('showAgentPanel') : t('collapseAgentPanel')"
          type="button"
          @click="$emit('toggle-collapse')"
        ></button>
      </div>
    </div>

    <div v-if="!collapsed" class="agent-toolbar">
      <select :value="mode" class="composer-pill" @change="$emit('mode-change', $event.target.value)">
        <option value="agent">Agent</option>
        <option value="plan">Plan</option>
        <option value="debug">Debug</option>
        <option value="multitask">Multitask</option>
        <option value="ask">Ask</option>
      </select>
      <select :value="model" class="composer-model" @change="$emit('model-change', $event.target.value)">
        <option value="gpt-4.1">GPT-4.1</option>
        <option value="gpt-4o">GPT-4o</option>
        <option value="claude-4-sonnet">Claude Sonnet</option>
      </select>
    </div>

    <div v-if="!collapsed" class="message-list agent-message-list">
      <article
        v-for="(message, index) in messages"
        :key="`${message.role}-${index}`"
        class="message-card"
        :class="`message-card--${message.role}`"
      >
        <div class="message-card__meta">
          <strong>{{ message.title }}</strong>
          <span>{{ message.role }}</span>
        </div>
        <p>{{ message.content }}</p>
      </article>
    </div>

    <div v-if="!collapsed" class="composer agent-composer">
      <textarea
        v-model="input"
        class="composer__input"
        rows="4"
        :placeholder="t('agentInputPlaceholder')"
      ></textarea>
      <div class="composer__bar">
        <div class="composer__left">
          <button class="icon-button codicon codicon-attach" :title="t('attach')"></button>
          <button class="icon-button codicon codicon-bookmark" :title="t('prompt')"></button>
        </div>
        <div class="composer__right">
          <button class="primary-button composer__button" @click="sendDraft">{{ t('send') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
