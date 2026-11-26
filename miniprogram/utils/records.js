// Labels come from the backend ScreeningTaskStatus enum; raw status is retained.
const labels = {
  QUEUED: ['待处理', 'warning'],
  TRANSCRIBING: ['转写中', 'working'],
  FEATURE_EXTRACTING: ['处理中', 'working'],
  LLM_ANALYZING: ['分析中', 'working'],
  RESULT_PERSISTING: ['保存中', 'working'],
  PDF_QUEUED: ['报告待生成', 'working'],
  PDF_GENERATING: ['生成报告中', 'working'],
  COMPLETED: ['已完成', 'success'],
  RETRY_WAIT: ['等待重试', 'warning'],
  FAILED: ['处理失败', 'error'],
  CANCEL_REQUESTED: ['取消中', 'working'],
  CANCELLED: ['已取消', 'neutral'],
  演示数据: ['演示数据', 'demo']
};
function presentRecord(record) {
  const pair = labels[record.status] || [record.status || '状态待确认', 'neutral'];
  const date = typeof record.createdAt === 'string' ? record.createdAt : '';
  return Object.assign({}, record, {
    statusLabel: pair[0],
    statusTone: pair[1],
    displayTime: date
      ? date
          .replace('T', ' ')
          .replace(/:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/, '')
          .slice(0, 16)
      : '',
    actionLabel: record.report ? '查看报告' : '查看详情'
  });
}
module.exports = { presentRecord };
