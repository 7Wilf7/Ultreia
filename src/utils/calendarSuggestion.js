const DATE_SIGNAL = /(?:\b20\d{2}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[/.月]\d{1,2}(?:日|号)?\b|\b(?:tomorrow|tonight|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|明天|后天|今晚|下周[一二三四五六日天]|周[一二三四五六日天])/iu;
const TRAINING_SIGNAL = /(?:跑|越野|公路|力量|核心|间歇|节奏|恢复|骑行|游泳|爬楼|徒步|HIIT|休息|训练|计划|安排|调整|改成|替换|取消|run|trail|strength|interval|tempo|recovery|cycling|swim|hike|rest|workout|session|plan|schedule|replace|move|cancel)/iu;
const ACTION_SIGNAL = /(?:建议|可以|安排|计划|改|调整|替换|取消|休息|完成|做|跑|练|should|recommend|schedule|plan|move|replace|cancel|rest|do|run|train)/iu;

export function hasActionableCalendarSuggestion(content) {
  const text = String(content || "").replace(/\s+/g, " ").trim();
  if (!text || text.length < 8) return false;
  if (/(?:已完成|完成得|finished|completed)/iu.test(text)
    && !/(?:建议|调整|改成|替换|取消|下一步|should|recommend|adjust|move|replace|cancel)/iu.test(text)) return false;
  return DATE_SIGNAL.test(text) && TRAINING_SIGNAL.test(text) && ACTION_SIGNAL.test(text);
}
