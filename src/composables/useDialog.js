import { reactive } from 'vue';

const state = reactive({
  visible: false,
  type: 'alert',
  title: '',
  message: '',
  resolve: null,
  reject: null
});

export function useDialogState() {
  return state;
}

export function useDialog() {
  function alert(message, title = '提示') {
    return new Promise((resolve) => {
      state.type = 'alert';
      state.title = title;
      state.message = message;
      state.resolve = resolve;
      state.reject = null;
      state.visible = true;
    });
  }

  function confirm(message, title = '确认') {
    return new Promise((resolve) => {
      state.type = 'confirm';
      state.title = title;
      state.message = message;
      state.resolve = resolve;
      state.reject = null;
      state.visible = true;
    });
  }

  return { alert, confirm };
}
