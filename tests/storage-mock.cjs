// 模拟持久化与跨视图通知，浏览器测试仅使用独立 origin 的 localStorage。
module.exports = function storageMock() {
    const listeners = [];
    const data = JSON.parse(localStorage.getItem('preferences') || '{}');
    window.chrome.storage = {
        local: {
            get: async () => ({...data}),
            set: async patch => {
                const changes = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, {oldValue: data[key], newValue: value}]));
                Object.assign(data, patch);
                localStorage.setItem('preferences', JSON.stringify(data));
                listeners.forEach(listener => listener(changes, 'local'));
            }
        },
        onChanged: {addListener: listener => listeners.push(listener)}
    };
    Object.defineProperty(navigator, 'clipboard', {value: {writeText: async value => { window.copied = value; }}, configurable: true});
};
