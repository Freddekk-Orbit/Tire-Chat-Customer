export function watchState(onState, onStatus) {
  let source;
  let retry;

  function connect() {
    onStatus('connecting');
    source = new EventSource('/events');
    source.addEventListener('state', (event) => {
      onStatus('live');
      onState(JSON.parse(event.data));
    });
    source.addEventListener('ping', () => onStatus('live'));
    source.onerror = () => {
      onStatus('reconnecting');
      source.close();
      clearTimeout(retry);
      retry = setTimeout(connect, 1000);
    };
  }

  connect();
}
