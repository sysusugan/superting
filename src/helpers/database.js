const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const { createHash, randomUUID } = require("crypto");
const debugLogger = require("./debugLogger");
const { app } = require("electron");
const { isRetainedAudioFile, parseMeetingAudioFilename } = require("./audioStorageFiles");
const { normalizeTrackingDraft } = require("./trackingIdentity");
const { isDeepStrictEqual } = require("node:util");

const NOTE_ORDER_BY = {
  updatedAt: "updated_at DESC, id DESC",
  createdAt: "created_at DESC, id DESC",
  recordedAt: "COALESCE(recorded_at, created_at) DESC, id DESC",
};

function getNoteOrderByClause(sortBy = "updatedAt") {
  return NOTE_ORDER_BY[sortBy || "updatedAt"] || NOTE_ORDER_BY.updatedAt;
}

function buildFolderReorderPlan(existingIds, requestedIds) {
  if (!Array.isArray(requestedIds) || requestedIds.length === 0) {
    throw new Error("Folder order is required");
  }

  const normalizedExistingIds = existingIds.map((id) => Number(id));
  const normalizedRequestedIds = requestedIds.map((id) => Number(id));
  if (normalizedRequestedIds.some((id) => !Number.isInteger(id))) {
    throw new Error("Folder order contains invalid folder ids");
  }

  const uniqueRequestedIds = new Set(normalizedRequestedIds);
  if (uniqueRequestedIds.size !== normalizedRequestedIds.length) {
    throw new Error("Folder order contains duplicate folder ids");
  }

  const existingIdSet = new Set(normalizedExistingIds);
  const hasSameIds =
    normalizedRequestedIds.length === normalizedExistingIds.length &&
    normalizedRequestedIds.every((id) => existingIdSet.has(id));
  if (!hasSameIds) {
    throw new Error("Folder order must include all existing folders");
  }

  return normalizedRequestedIds.map((id, sortOrder) => ({ id, sortOrder }));
}

function serializeJsonColumn(value) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function safeJson(value, fallback = null) {
  if (value && typeof value === "object") return value;
  try {
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function trackingDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return null;
  const dateOnly = value.slice(0, 10);
  const calendar = new Date(`${dateOnly}T00:00:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== dateOnly)
    return null;
  if (value.length === 10) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function buildSaveTranscriptionInsert(
  text,
  rawText = null,
  {
    status = "completed",
    errorMessage = null,
    errorCode = null,
    clientTranscriptionId = randomUUID(),
    provider = null,
    model = null,
    language = null,
    audioDurationMs = null,
    warning = null,
    partial = false,
    processingMetadata = null,
  } = {}
) {
  return {
    sql: "INSERT INTO transcriptions (text, raw_text, status, error_message, error_code, client_transcription_id, provider, model, language, audio_duration_ms, warning, partial, processing_metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    values: [
      text,
      rawText,
      status,
      errorMessage,
      errorCode,
      clientTranscriptionId,
      provider,
      model,
      language,
      audioDurationMs,
      warning,
      partial ? 1 : 0,
      serializeJsonColumn(processingMetadata),
    ],
  };
}

const DEFAULT_NOTE_ACTIONS = [
  {
    key: "notes.actions.builtin.meetingMinutes",
    name: "生成会议纪要",
    description: "将会议转录整理为结构化会议纪要",
    prompt:
      "你是一名专业的企业会议纪要整理助手。\n\n请基于我提供的会议录音转写文本，整理成一份结构清晰、重点明确、可直接用于工作汇报和项目跟进的会议纪要。\n\n整理要求：\n\n1. 只基于原始文本整理，不要自行脑补、扩展或加入未出现的信息。\n2. 对明显的口语、重复、语病进行适度清理，但不要改变原意。\n3. 信息要归类清楚，避免流水账。\n4. 重点突出：会议结论、关键事项、待办任务、负责人、时间节点、风险问题。\n5. 如果原文中没有明确负责人、时间节点或结论，请标注“未明确”，不要猜测。\n6. 对模糊表达可以做归纳，但要保持谨慎，不要过度推断。\n7. 输出语言保持正式、客观、简洁，偏企业内部工作汇报口径。\n8. 不要输出分析过程，只输出整理后的会议纪要。\n9. 如果原文包含时间戳，请保留并用于最后的“章节划分”；如果没有时间戳，则按内容顺序进行章节划分。\n10. 最后的“章节划分”必须放在全文最后，用于快速回看录音内容，不要放在开头。\n\n请按以下结构输出：\n\n# 会议纪要\n\n## 一、会议基本信息\n- 会议主题：根据内容提炼\n- 会议时间：如原文未提及，写“未明确”\n- 参会人员：如原文未提及，写“未明确”\n- 会议背景：用1-2句话概括本次会议讨论的业务背景\n\n## 二、核心结论\n用编号列出本次会议已经达成的关键判断、共识或决定。\n\n要求：\n- 每条结论清晰、完整、可执行。\n- 不要写成泛泛而谈的总结。\n- 如果只是讨论但未形成结论，请不要放入本部分。\n\n## 三、重点讨论事项\n按议题分组整理，每个议题包括：\n1. 讨论内容\n2. 当前进展\n3. 关键问题\n4. 初步判断或结论\n\n格式如下：\n\n### 1. 议题名称\n- 讨论内容：\n- 当前进展：\n- 关键问题：\n- 结论/判断：\n\n## 四、待办事项\n请整理成表格：\n\n| 序号 | 待办事项 | 负责人 | 截止时间 | 备注 |\n|---|---|---|---|---|\n\n要求：\n- 只提炼明确需要后续推进的事项。\n- 如果负责人或截止时间没有明确，请写“未明确”。\n- 不要把泛泛的讨论内容写成待办。\n\n## 五、风险与问题\n列出会议中提到的风险、阻塞点、不确定事项。\n\n格式如下：\n\n### 1. 风险/问题名称\n- 风险/问题：\n- 可能影响：\n- 建议关注点：\n\n## 六、后续跟进建议\n基于会议内容，整理下一步建议推进方向。\n\n要求：\n- 控制在3-5条以内。\n- 必须基于会议内容，不要发散。\n- 语言偏工作推进口径。\n\n## 七、章节划分\n请在最后输出会议录音的章节划分，用于快速回看录音内容。\n\n章节划分要求：\n\n1. 按会议讨论的时间顺序输出。\n2. 如果原文有时间戳，每个章节必须保留起始时间。\n3. 每个章节包含：\n   - 起始时间\n   - 章节标题\n   - 章节摘要\n4. 章节标题要短、准、信息密度高，能够概括该段核心议题。\n5. 章节摘要用1-3句话概括该时间段讨论的主要内容。\n6. 章节划分不要照抄原文，要提炼归纳。\n7. 章节数量根据会议内容自然划分，一般控制在5-12个。\n8. 如果某段内容只是闲聊、寒暄、无实质信息，可以忽略。\n9. 章节划分是“时间轴导航”，不要与前面的会议纪要完全重复。\n\n输出格式如下：\n\n### 00:00:00 章节标题\n章节摘要内容。\n\n### 00:02:17 章节标题\n章节摘要内容。\n\n### 00:04:36 章节标题\n章节摘要内容。\n\n以下是会议录音转写文本：\n\n【在这里粘贴会议转写文本】",
    isBuiltin: 1,
    sortOrder: 0,
  },
  {
    key: "notes.actions.presets.interviewReview",
    name: "生成面评",
    description: "将面试记录整理为候选人评价",
    prompt:
      "请根据面试记录生成结构化面评，使用 Markdown，包含：\n\n1. 候选人整体评价\n2. 技术能力或专业能力表现\n3. 项目经验与问题解决能力\n4. 沟通表达与协作表现\n5. 亮点\n6. 风险或疑点\n7. 建议结论：通过 / 待定 / 不通过\n8. 后续建议\n\n要求：\n- 只基于记录中出现的信息进行评价\n- 不要添加歧视性、主观臆测或与岗位无关的判断\n- 对不确定的信息标注“记录中未明确”\n- 保留关键事实、具体例子和候选人的原始表述含义\n- 语气客观、专业，适合提交给招聘或用人团队",
    isBuiltin: 0,
    sortOrder: 1,
  },
  {
    key: "notes.actions.presets.generateNotes",
    name: "生成笔记",
    description: "将原始内容整理为清晰的结构化笔记",
    prompt:
      "请将提供的内容整理为清晰、结构化的笔记，使用 Markdown。\n\n请根据内容本身选择合适结构，可包含：\n\n1. 摘要\n2. 主要内容\n3. 关键观点\n4. 重要细节\n5. 待办事项或后续动作\n\n要求：\n- 保留用户的原意和所有实质信息\n- 优化语法、措辞和结构，让内容更易读\n- 删除口头禅、重复内容、停顿和无意义表达\n- 不要编造原文没有的信息\n- 如果内容很短，请直接整理为简洁笔记，不要强行扩展",
    isBuiltin: 0,
    sortOrder: 2,
  },
  {
    key: "notes.actions.presets.optimizeTranscript",
    name: "优化转录文本",
    description: "清理语音转录文本，使其更准确、流畅、易读",
    prompt:
      "请优化以下语音转录文本，使其更准确、流畅、易读。\n\n要求：\n- 修正明显的错别字、同音误识别、标点和断句问题\n- 保留原始含义、语气和信息顺序\n- 不要总结、扩写或改写成另一种文体\n- 不要删除重要细节、数字、人名、公司名、产品名或专有名词\n- 删除明显的口头禅、重复停顿和无意义填充词\n- 如果原文是口语表达，请整理为自然书面表达，但不要过度润色\n- 只输出优化后的文本，不要添加解释",
    isBuiltin: 0,
    sortOrder: 3,
  },
  {
    key: "notes.actions.builtin.extractTracking",
    name: "提取事项",
    description: "从当前笔记中提取关联事项、进展、风险和证据",
    prompt:
      '请从当前笔记中提取可持续追踪的工作事项。只输出合法 JSON，不要 Markdown 代码围栏或解释。\n\n事项类型仅可使用：商机、项目、产品能力、生态合作项目。\n\n输出结构：{"matchedItems":[{"title":"","itemType":"","confidence":0,"reason":""}],"newItems":[{"title":"","itemType":"","state":"","properties":{}}],"updates":[{"itemTitle":"","updateType":"进展|风险|结果|下一步|关联","content":"","occurredAt":"","stateAfter":"","evidence":"","relatedItemTitle":"","relationType":""}],"uncertainties":[]}。\n\n只提取原文明确出现的事实，不要把计划写成结果；evidence 必须是原文中的短句；无法确定的内容放入 uncertainties。',
    isBuiltin: 1,
    sortOrder: 4,
    tracking: true,
  },
];

class DatabaseManager {
  constructor(options = {}) {
    this.db = null;
    this.dbPath = options.dbPath || null;
    this.initDatabase();
  }

  initDatabase() {
    try {
      const dbFileName =
        process.env.NODE_ENV === "development" ? "transcriptions-dev.db" : "transcriptions.db";

      const dbPath = this.dbPath || path.join(app.getPath("userData"), dbFileName);

      this.db = new Database(dbPath);
      this.db.function("tracking_day", trackingDay);
      this.db.pragma("journal_mode = WAL");
      const trackingExists = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tracking_items'")
        .get();
      if (
        trackingExists &&
        !this.db
          .pragma("table_info(tracking_items)")
          .some((column) => column.name === "manual_state")
      ) {
        // VACUUM INTO includes the WAL in a consistent SQLite snapshot; never copy a live .db file.
        const backupPath = `${dbPath}.tracking-center-${Date.now()}-${randomUUID()}.bak`;
        this.db.prepare("VACUUM INTO ?").run(backupPath);
      }

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS transcriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          text TEXT NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Audio retention columns
      try {
        this.db.exec("ALTER TABLE transcriptions ADD COLUMN raw_text TEXT");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE transcriptions ADD COLUMN has_audio INTEGER NOT NULL DEFAULT 0");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE transcriptions ADD COLUMN audio_duration_ms INTEGER");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE transcriptions ADD COLUMN provider TEXT");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE transcriptions ADD COLUMN model TEXT");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec(
          "ALTER TABLE transcriptions ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'"
        );
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE transcriptions ADD COLUMN error_message TEXT");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE transcriptions ADD COLUMN error_code TEXT");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE transcriptions ADD COLUMN language TEXT");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE transcriptions ADD COLUMN warning TEXT");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE transcriptions ADD COLUMN partial INTEGER NOT NULL DEFAULT 0");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE transcriptions ADD COLUMN processing_metadata TEXT");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS custom_dictionary (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          word TEXT NOT NULL UNIQUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS custom_dictionary_aliases (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          from_text TEXT NOT NULL UNIQUE,
          to_text TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL DEFAULT 'Untitled Note',
          content TEXT NOT NULL DEFAULT '',
          note_type TEXT NOT NULL DEFAULT 'personal',
          source_file TEXT,
          audio_duration_seconds REAL,
          recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL COLLATE NOCASE UNIQUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS note_tags (
          note_id INTEGER NOT NULL,
          tag_id INTEGER NOT NULL,
          PRIMARY KEY (note_id, tag_id),
          FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
          FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_note_tags_tag_id_note_id
        ON note_tags(tag_id, note_id);
      `);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS note_audio_files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          note_id INTEGER NOT NULL,
          filename TEXT NOT NULL,
          duration_seconds REAL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          recorded_at DATETIME,
          UNIQUE(note_id, filename),
          FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
        )
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_note_audio_files_note_id_recorded_at
        ON note_audio_files(note_id, recorded_at DESC, id DESC)
      `);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS note_assets (
          id TEXT PRIMARY KEY,
          note_id INTEGER NOT NULL,
          filename TEXT NOT NULL,
          stored_filename TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
        )
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_note_assets_note_id_created_at
        ON note_assets(note_id, created_at ASC)
      `);

      try {
        this.db.exec("ALTER TABLE notes ADD COLUMN enhanced_content TEXT");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE notes ADD COLUMN enhancement_prompt TEXT");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE notes ADD COLUMN enhanced_at_content_hash TEXT");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE notes ADD COLUMN cloud_id TEXT");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }

      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
          title,
          content,
          enhanced_content,
          content='notes',
          content_rowid='id'
        )
      `);

      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS notes_fts_insert AFTER INSERT ON notes BEGIN
          INSERT INTO notes_fts(rowid, title, content, enhanced_content)
          VALUES (new.id, new.title, new.content, new.enhanced_content);
        END
      `);

      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS notes_fts_update AFTER UPDATE ON notes BEGIN
          INSERT INTO notes_fts(notes_fts, rowid, title, content, enhanced_content)
          VALUES ('delete', old.id, old.title, old.content, old.enhanced_content);
          INSERT INTO notes_fts(rowid, title, content, enhanced_content)
          VALUES (new.id, new.title, new.content, new.enhanced_content);
        END
      `);

      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS notes_fts_delete AFTER DELETE ON notes BEGIN
          INSERT INTO notes_fts(notes_fts, rowid, title, content, enhanced_content)
          VALUES ('delete', old.id, old.title, old.content, old.enhanced_content);
        END
      `);

      this.db
        .prepare(
          `
        INSERT OR IGNORE INTO notes_fts(rowid, title, content, enhanced_content)
        SELECT id, COALESCE(title, ''), COALESCE(content, ''), COALESCE(enhanced_content, '')
        FROM notes
      `
        )
        .run();

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS folders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          is_default INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      const folderCount = this.db.prepare("SELECT COUNT(*) as count FROM folders").get();
      if (folderCount.count === 0) {
        const seedFolder = this.db.prepare(
          "INSERT INTO folders (name, is_default, sort_order) VALUES (?, 1, ?)"
        );
        seedFolder.run("Personal", 0);
        seedFolder.run("Meetings", 1);
      }

      try {
        this.db.exec("ALTER TABLE notes ADD COLUMN folder_id INTEGER REFERENCES folders(id)");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }

      const personalFolder = this.db
        .prepare("SELECT id FROM folders WHERE name = 'Personal' AND is_default = 1")
        .get();
      if (personalFolder) {
        this.db
          .prepare("UPDATE notes SET folder_id = ? WHERE folder_id IS NULL")
          .run(personalFolder.id);
      }

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS actions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          prompt TEXT NOT NULL,
          icon TEXT NOT NULL DEFAULT 'sparkles',
          output_target TEXT NOT NULL DEFAULT 'content',
          write_mode TEXT NOT NULL DEFAULT 'overwrite',
          is_builtin INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      try {
        this.db.exec("ALTER TABLE actions ADD COLUMN translation_key TEXT");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec(
          "ALTER TABLE actions ADD COLUMN output_target TEXT NOT NULL DEFAULT 'content'"
        );
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE actions ADD COLUMN write_mode TEXT NOT NULL DEFAULT 'overwrite'");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS tracking_templates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          definition_json TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS tracking_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          template_id INTEGER NOT NULL REFERENCES tracking_templates(id),
          title TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT '进行中',
          properties_json TEXT NOT NULL DEFAULT '{}',
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS tracking_updates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item_id INTEGER NOT NULL REFERENCES tracking_items(id),
          note_id INTEGER NOT NULL REFERENCES notes(id),
          update_type TEXT NOT NULL,
          content TEXT NOT NULL,
          occurred_at DATETIME,
          state_after TEXT,
          evidence_text TEXT NOT NULL DEFAULT '',
          related_item_id INTEGER REFERENCES tracking_items(id),
          relation_type TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS tracking_extractions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          note_id INTEGER NOT NULL REFERENCES notes(id),
          action_id INTEGER NOT NULL REFERENCES actions(id),
          input_hash TEXT NOT NULL,
          template_version INTEGER NOT NULL DEFAULT 1,
          result_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          supersedes_id INTEGER REFERENCES tracking_extractions(id),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_tracking_updates_item_date
          ON tracking_updates(item_id, occurred_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_tracking_updates_note
          ON tracking_updates(note_id, id DESC);
        CREATE INDEX IF NOT EXISTS idx_tracking_extractions_lookup
          ON tracking_extractions(note_id, action_id, input_hash, template_version, status);
      `);
      try {
        this.db.exec("ALTER TABLE tracking_updates ADD COLUMN state_after TEXT");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE tracking_items ADD COLUMN state_source_update_id INTEGER");
        this.db.exec(`UPDATE tracking_items SET state_source_update_id = (
          SELECT id FROM tracking_updates WHERE item_id = tracking_items.id
          AND state_after = tracking_items.state ORDER BY id DESC LIMIT 1)`);
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      this.db.transaction(() => {
        if (
          !this.db
            .pragma("table_info(tracking_items)")
            .some((column) => column.name === "manual_state")
        ) {
          this.db.exec(
            "ALTER TABLE tracking_items ADD COLUMN manual_state INTEGER NOT NULL DEFAULT 0"
          );
          this.db
            .exec(`UPDATE tracking_items SET manual_state = 1 WHERE state_source_update_id IS NULL
            AND EXISTS (SELECT 1 FROM tracking_updates WHERE item_id = tracking_items.id AND state_after IS NOT NULL)`);
        }
        this.db.exec(`CREATE TABLE IF NOT EXISTS tracking_operations (
          id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL REFERENCES tracking_items(id),
          operation TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL,
          entrypoint TEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ); CREATE INDEX IF NOT EXISTS idx_tracking_operations_item ON tracking_operations(item_id, id DESC)`);
      })();
      this._seedTrackingTemplates();

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS agent_conversations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL DEFAULT 'Untitled',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS agent_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id INTEGER NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
          content TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      this.db.exec(
        "CREATE INDEX IF NOT EXISTS idx_agent_messages_conversation ON agent_messages(conversation_id)"
      );

      try {
        this.db.exec("ALTER TABLE agent_messages ADD COLUMN metadata TEXT");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE agent_conversations ADD COLUMN archived_at DATETIME");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE agent_conversations ADD COLUMN cloud_id TEXT");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE agent_conversations ADD COLUMN note_id INTEGER");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      this.db.exec(
        "CREATE INDEX IF NOT EXISTS idx_agent_conversations_note ON agent_conversations(note_id)"
      );

      this._seedDefaultActions();

      try {
        this.db.exec("ALTER TABLE notes ADD COLUMN transcript TEXT");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE notes ADD COLUMN recorded_at DATETIME");
        this.db.exec("UPDATE notes SET recorded_at = created_at WHERE recorded_at IS NULL");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE notes ADD COLUMN participants TEXT");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE notes ADD COLUMN diarization_enabled INTEGER");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE notes ADD COLUMN expected_speaker_count INTEGER");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS contacts (
          email TEXT PRIMARY KEY,
          display_name TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS speaker_profiles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          display_name TEXT NOT NULL,
          email TEXT,
          embedding BLOB NOT NULL,
          sample_count INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS speaker_names (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          display_name TEXT NOT NULL COLLATE NOCASE UNIQUE,
          email TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS speaker_mappings (
          note_id INTEGER NOT NULL,
          speaker_id TEXT NOT NULL,
          profile_id INTEGER,
          display_name TEXT NOT NULL,
          PRIMARY KEY (note_id, speaker_id),
          FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
          FOREIGN KEY (profile_id) REFERENCES speaker_profiles(id) ON DELETE SET NULL
        )
      `);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS note_speaker_embeddings (
          note_id INTEGER NOT NULL,
          speaker_id TEXT NOT NULL,
          embedding BLOB NOT NULL,
          PRIMARY KEY (note_id, speaker_id),
          FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
        )
      `);

      // Sync columns for notes
      try {
        this.db.exec("ALTER TABLE notes ADD COLUMN client_note_id TEXT");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE notes ADD COLUMN sync_status TEXT DEFAULT 'pending'");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE notes ADD COLUMN deleted_at TEXT");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }

      // Sync columns for folders
      try {
        this.db.exec("ALTER TABLE folders ADD COLUMN client_folder_id TEXT");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }

      this.backfillNoteAudioFiles();
      try {
        this.db.exec("ALTER TABLE folders ADD COLUMN cloud_id TEXT");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE folders ADD COLUMN sync_status TEXT DEFAULT 'pending'");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE folders ADD COLUMN deleted_at TEXT");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE folders ADD COLUMN updated_at DATETIME");
        this.db.exec("UPDATE folders SET updated_at = created_at WHERE updated_at IS NULL");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }

      // Sync columns for agent_conversations
      try {
        this.db.exec("ALTER TABLE agent_conversations ADD COLUMN client_conversation_id TEXT");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec(
          "ALTER TABLE agent_conversations ADD COLUMN sync_status TEXT DEFAULT 'pending'"
        );
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE agent_conversations ADD COLUMN deleted_at TEXT");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }

      // Sync columns for transcriptions
      try {
        this.db.exec("ALTER TABLE transcriptions ADD COLUMN client_transcription_id TEXT");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE transcriptions ADD COLUMN cloud_id TEXT");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE transcriptions ADD COLUMN sync_status TEXT DEFAULT 'pending'");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }
      try {
        this.db.exec("ALTER TABLE transcriptions ADD COLUMN deleted_at TEXT");
      } catch (err) {
        if (!err.message.includes("duplicate column")) throw err;
      }

      // Backfill client IDs for existing rows
      const syncTables = [
        { table: "notes", col: "client_note_id" },
        { table: "folders", col: "client_folder_id" },
        { table: "agent_conversations", col: "client_conversation_id" },
        { table: "transcriptions", col: "client_transcription_id" },
      ];
      for (const { table, col } of syncTables) {
        const rows = this.db.prepare(`SELECT id FROM ${table} WHERE ${col} IS NULL`).all();
        const stmt = this.db.prepare(`UPDATE ${table} SET ${col} = ? WHERE id = ?`);
        for (const row of rows) {
          stmt.run(randomUUID(), row.id);
        }
      }

      this.db.exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_client_note_id ON notes(client_note_id)"
      );
      this.db.exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_client_folder_id ON folders(client_folder_id)"
      );
      this.db.exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_client_id ON agent_conversations(client_conversation_id)"
      );
      this.db.exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_transcriptions_client_id ON transcriptions(client_transcription_id)"
      );

      return true;
    } catch (error) {
      debugLogger.error("Database initialization failed", { error: error.message }, "database");
      this.db?.close();
      this.db = null;
      throw error;
    }
  }

  saveTranscription(text, rawText = null, options = {}) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const insert = buildSaveTranscriptionInsert(text, rawText, options);
      const stmt = this.db.prepare(insert.sql);
      const result = stmt.run(...insert.values);

      const fetchStmt = this.db.prepare("SELECT * FROM transcriptions WHERE id = ?");
      const transcription = fetchStmt.get(result.lastInsertRowid);

      return { id: result.lastInsertRowid, success: true, transcription };
    } catch (error) {
      debugLogger.error("Error saving transcription", { error: error.message }, "database");
      throw error;
    }
  }

  getTranscriptions(limit = 50) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const stmt = this.db.prepare(
        "SELECT * FROM transcriptions WHERE deleted_at IS NULL ORDER BY timestamp DESC LIMIT ?"
      );
      const transcriptions = stmt.all(limit);
      return transcriptions;
    } catch (error) {
      debugLogger.error("Error getting transcriptions", { error: error.message }, "database");
      throw error;
    }
  }

  clearTranscriptions() {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const tombstone = this.db.prepare(
        "UPDATE transcriptions SET deleted_at = datetime('now'), sync_status = 'pending' WHERE cloud_id IS NOT NULL AND deleted_at IS NULL"
      );
      const hardDelete = this.db.prepare("DELETE FROM transcriptions WHERE cloud_id IS NULL");
      const clearAll = this.db.transaction(
        () => tombstone.run().changes + hardDelete.run().changes
      );
      return { cleared: clearAll(), success: true };
    } catch (error) {
      debugLogger.error("Error clearing transcriptions", { error: error.message }, "database");
      throw error;
    }
  }

  deleteTranscription(id) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const row = this.db
        .prepare("SELECT cloud_id, deleted_at FROM transcriptions WHERE id = ?")
        .get(id);
      if (!row || row.deleted_at) return { success: false, id };
      const stmt = row.cloud_id
        ? this.db.prepare(
            "UPDATE transcriptions SET deleted_at = datetime('now'), sync_status = 'pending' WHERE id = ? AND deleted_at IS NULL"
          )
        : this.db.prepare("DELETE FROM transcriptions WHERE id = ?");
      const result = stmt.run(id);
      return { success: result.changes > 0, id };
    } catch (error) {
      debugLogger.error("Error deleting transcription", { error: error.message }, "database");
      throw error;
    }
  }

  updateTranscriptionAudio(id, { hasAudio, audioDurationMs, provider, model }) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const stmt = this.db.prepare(
        "UPDATE transcriptions SET has_audio = ?, audio_duration_ms = ?, provider = ?, model = ? WHERE id = ?"
      );
      stmt.run(hasAudio, audioDurationMs, provider, model, id);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error updating transcription audio", { error: error.message }, "database");
      throw error;
    }
  }

  updateTranscriptionText(id, text, rawText) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const stmt = this.db.prepare("UPDATE transcriptions SET text = ?, raw_text = ? WHERE id = ?");
      stmt.run(text, rawText, id);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error updating transcription text", { error: error.message }, "database");
      throw error;
    }
  }

  updateTranscriptionResult(
    id,
    { text, rawText, warning = null, partial = false, processingMetadata = null }
  ) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const stmt = this.db.prepare(
        "UPDATE transcriptions SET text = ?, raw_text = ?, warning = ?, partial = ?, processing_metadata = ? WHERE id = ?"
      );
      stmt.run(
        text,
        rawText,
        warning,
        partial ? 1 : 0,
        serializeJsonColumn(processingMetadata),
        id
      );
      return { success: true };
    } catch (error) {
      debugLogger.error(
        "Error updating transcription result",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  updateTranscriptionStatus(id, status, errorMessage = null, errorCode = null) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const stmt = this.db.prepare(
        "UPDATE transcriptions SET status = ?, error_message = ?, error_code = ? WHERE id = ?"
      );
      stmt.run(status, errorMessage, errorCode, id);
      return { success: true };
    } catch (error) {
      debugLogger.error(
        "Error updating transcription status",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  getTranscriptionById(id) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const stmt = this.db.prepare("SELECT * FROM transcriptions WHERE id = ?");
      return stmt.get(id) || null;
    } catch (error) {
      debugLogger.error("Error getting transcription by id", { error: error.message }, "database");
      throw error;
    }
  }

  clearAudioFlags(ids) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      if (!ids || ids.length === 0) return { success: true };
      const transaction = this.db.transaction((idList) => {
        const stmt = this.db.prepare("UPDATE transcriptions SET has_audio = 0 WHERE id = ?");
        for (const id of idList) {
          stmt.run(id);
        }
      });
      transaction(ids);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error clearing audio flags", { error: error.message }, "database");
      throw error;
    }
  }

  getDictionary() {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const stmt = this.db.prepare("SELECT word FROM custom_dictionary ORDER BY id ASC");
      const rows = stmt.all();
      return rows.map((row) => row.word);
    } catch (error) {
      debugLogger.error("Error getting dictionary", { error: error.message }, "database");
      throw error;
    }
  }

  setDictionary(words) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const transaction = this.db.transaction((wordList) => {
        this.db.prepare("DELETE FROM custom_dictionary").run();
        const insert = this.db.prepare("INSERT OR IGNORE INTO custom_dictionary (word) VALUES (?)");
        for (const word of wordList) {
          const trimmed = typeof word === "string" ? word.trim() : "";
          if (trimmed) {
            insert.run(trimmed);
          }
        }
      });
      transaction(words);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error setting dictionary", { error: error.message }, "database");
      throw error;
    }
  }

  getDictionaryAliases() {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const stmt = this.db.prepare(
        "SELECT from_text, to_text FROM custom_dictionary_aliases ORDER BY id ASC"
      );
      const rows = stmt.all();
      return rows.map((row) => ({ from: row.from_text, to: row.to_text }));
    } catch (error) {
      debugLogger.error("Error getting dictionary aliases", { error: error.message }, "database");
      throw error;
    }
  }

  setDictionaryAliases(aliases) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const transaction = this.db.transaction((aliasList) => {
        this.db.prepare("DELETE FROM custom_dictionary_aliases").run();
        const insert = this.db.prepare(
          "INSERT OR IGNORE INTO custom_dictionary_aliases (from_text, to_text) VALUES (?, ?)"
        );
        const seen = new Set();
        for (const alias of Array.isArray(aliasList) ? aliasList : []) {
          const from = typeof alias?.from === "string" ? alias.from.trim() : "";
          const to = typeof alias?.to === "string" ? alias.to.trim() : "";
          if (!from || !to || from.toLowerCase() === to.toLowerCase()) continue;
          const key = from.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          insert.run(from, to);
        }
      });
      transaction(aliases);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error setting dictionary aliases", { error: error.message }, "database");
      throw error;
    }
  }

  normalizeTagNames(tags) {
    const normalized = [];
    const seen = new Set();
    for (const value of Array.isArray(tags) ? tags : []) {
      const name = typeof value === "string" ? value.trim() : "";
      const key = name.toLocaleLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      normalized.push(name);
    }
    return normalized;
  }

  attachTags(notes) {
    const list = Array.isArray(notes) ? notes : notes ? [notes] : [];
    if (list.length === 0) return Array.isArray(notes) ? [] : null;
    const ids = list.map((note) => note.id);
    const placeholders = ids.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT nt.note_id, t.name
         FROM note_tags nt
         JOIN tags t ON t.id = nt.tag_id
         WHERE nt.note_id IN (${placeholders})
         ORDER BY t.name COLLATE NOCASE ASC, t.id ASC`
      )
      .all(...ids);
    const tagsByNoteId = new Map();
    for (const row of rows) {
      const names = tagsByNoteId.get(row.note_id) || [];
      names.push(row.name);
      tagsByNoteId.set(row.note_id, names);
    }
    const tagged = list.map((note) => ({ ...note, tags: tagsByNoteId.get(note.id) || [] }));
    return Array.isArray(notes) ? tagged : tagged[0];
  }

  replaceNoteTags(noteId, tags) {
    const names = this.normalizeTagNames(tags);
    this.db.prepare("DELETE FROM note_tags WHERE note_id = ?").run(noteId);
    const insertTag = this.db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)");
    const findTag = this.db.prepare("SELECT id FROM tags WHERE name = ? COLLATE NOCASE");
    const linkTag = this.db.prepare(
      "INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)"
    );
    for (const name of names) {
      insertTag.run(name);
      const tag = findTag.get(name);
      if (tag) linkTag.run(noteId, tag.id);
    }
    this.db
      .prepare("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM note_tags)")
      .run();
  }

  getTags() {
    if (!this.db) throw new Error("Database not initialized");
    return this.db
      .prepare(
        `SELECT t.id, t.name, COUNT(nt.note_id) AS note_count
         FROM tags t
         JOIN note_tags nt ON nt.tag_id = t.id
         JOIN notes n ON n.id = nt.note_id AND n.deleted_at IS NULL
         GROUP BY t.id, t.name
         ORDER BY t.name COLLATE NOCASE ASC, t.id ASC`
      )
      .all();
  }

  saveNote(
    title,
    content,
    noteType = "personal",
    sourceFile = null,
    audioDuration = null,
    folderId = null,
    transcript = null,
    tags = []
  ) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      if (!folderId) {
        const defaultFolderName = noteType === "meeting" ? "Meetings" : "Personal";
        const defaultFolder = this.db
          .prepare("SELECT id FROM folders WHERE name = ? AND is_default = 1")
          .get(defaultFolderName);
        folderId = defaultFolder?.id || null;
      }
      const clientNoteId = randomUUID();
      return this.db.transaction(() => {
        const stmt = this.db.prepare(
          "INSERT INTO notes (title, content, note_type, source_file, audio_duration_seconds, folder_id, client_note_id, transcript, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)"
        );
        const result = stmt.run(
          title,
          content,
          noteType,
          sourceFile,
          audioDuration,
          folderId,
          clientNoteId,
          transcript
        );
        this.replaceNoteTags(result.lastInsertRowid, tags);
        const note = this.db
          .prepare("SELECT * FROM notes WHERE id = ?")
          .get(result.lastInsertRowid);
        return { success: true, note: this.attachTags(note) };
      })();
    } catch (error) {
      debugLogger.error("Error saving note", { error: error.message }, "notes");
      throw error;
    }
  }

  getNote(id) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const stmt = this.db.prepare("SELECT * FROM notes WHERE id = ?");
      return this.attachTags(stmt.get(id) || null);
    } catch (error) {
      debugLogger.error("Error getting note", { error: error.message }, "notes");
      throw error;
    }
  }

  getNotes(
    noteType = null,
    limit = 100,
    folderId = null,
    sortBy = "updatedAt",
    tags = [],
    offset = 0
  ) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const conditions = ["deleted_at IS NULL"];
      const params = [];
      if (noteType) {
        conditions.push("note_type = ?");
        params.push(noteType);
      }
      if (folderId) {
        conditions.push("folder_id = ?");
        params.push(folderId);
      }
      const tagNames = this.normalizeTagNames(tags);
      if (tagNames.length > 0) {
        const placeholders = tagNames.map(() => "?").join(", ");
        conditions.push(
          `id IN (
            SELECT nt.note_id
            FROM note_tags nt
            JOIN tags t ON t.id = nt.tag_id
            WHERE LOWER(t.name) IN (${placeholders})
          )`
        );
        params.push(...tagNames.map((name) => name.toLocaleLowerCase()));
      }
      const where = `WHERE ${conditions.join(" AND ")}`;
      const orderBy = getNoteOrderByClause(sortBy);
      const stmt = this.db.prepare(
        `SELECT * FROM notes ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
      );
      params.push(limit, offset);
      return this.attachTags(stmt.all(...params));
    } catch (error) {
      debugLogger.error("Error getting notes", { error: error.message }, "notes");
      throw error;
    }
  }

  updateNote(id, updates) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const allowedFields = [
        "title",
        "content",
        "enhanced_content",
        "enhancement_prompt",
        "enhanced_at_content_hash",
        "folder_id",
        "transcript",
        "participants",
        "diarization_enabled",
        "expected_speaker_count",
        "source_file",
        "audio_duration_seconds",
        "recorded_at",
        "sync_status",
        "deleted_at",
        "client_note_id",
        "cloud_id",
      ];
      const hasTags = Object.prototype.hasOwnProperty.call(updates || {}, "tags");
      const fields = [];
      const values = [];
      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key) && value !== undefined) {
          fields.push(`${key} = ?`);
          values.push(value);
        }
      }
      if (fields.length === 0 && !hasTags) return { success: false };
      fields.push("updated_at = CURRENT_TIMESTAMP");
      values.push(id);
      return this.db.transaction(() => {
        const stmt = this.db.prepare(
          `UPDATE notes SET ${fields.join(", ")} WHERE id = ? AND deleted_at IS NULL`
        );
        const result = stmt.run(...values);
        if (result.changes === 0) return { success: false };
        if (hasTags) this.replaceNoteTags(id, updates.tags);
        const note = this.db.prepare("SELECT * FROM notes WHERE id = ?").get(id);
        return { success: true, note: this.attachTags(note) };
      })();
    } catch (error) {
      debugLogger.error("Error updating note", { error: error.message }, "notes");
      throw error;
    }
  }

  backfillNoteAudioFiles() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      this.db
        .prepare(
          `INSERT OR IGNORE INTO note_audio_files
            (note_id, filename, duration_seconds, recorded_at)
           SELECT id, source_file, audio_duration_seconds, created_at
           FROM notes
           WHERE source_file IS NOT NULL
             AND TRIM(source_file) != ''
             AND (LOWER(source_file) LIKE '%.wav' OR LOWER(source_file) LIKE '%.webm')`
        )
        .run();
      return { success: true };
    } catch (error) {
      debugLogger.error("Error backfilling note audio files", { error: error.message }, "notes");
      throw error;
    }
  }

  backfillNoteAudioFilesFromDirectory(audioDir) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const dir = String(audioDir || "");
      if (!dir || !fs.existsSync(dir)) return { success: true, inserted: 0 };

      const filenames = fs
        .readdirSync(dir)
        .filter((filename) => isRetainedAudioFile(filename) && parseMeetingAudioFilename(filename));
      if (filenames.length === 0) return { success: true, inserted: 0 };

      const insert = this.db.prepare(
        `INSERT OR IGNORE INTO note_audio_files
          (note_id, filename, duration_seconds, recorded_at)
         VALUES (?, ?, ?, ?)`
      );
      const noteExists = this.db.prepare("SELECT id FROM notes WHERE id = ?");
      const updateLatest = this.db.prepare(
        `UPDATE notes
         SET source_file = ?,
             audio_duration_seconds = ?,
             updated_at = CURRENT_TIMESTAMP,
             sync_status = 'pending'
         WHERE id = ?`
      );
      const notes = this.db.prepare("SELECT id, source_file FROM notes").all();

      const available = new Set(filenames);
      const transaction = this.db.transaction(() => {
        let inserted = 0;
        for (const filename of filenames) {
          const parsed = parseMeetingAudioFilename(filename);
          if (!parsed || !noteExists.get(parsed.noteId)) continue;

          let durationSeconds = null;
          try {
            const stats = fs.statSync(path.join(dir, filename));
            if (stats.size > 44) {
              durationSeconds = (stats.size - 44) / (24000 * 1 * 2);
            }
          } catch {}

          const result = insert.run(parsed.noteId, filename, durationSeconds, parsed.recordedAt);
          inserted += result.changes;
        }

        for (const note of notes) {
          if (note.source_file && available.has(note.source_file)) continue;
          const latest = this.db
            .prepare(
              `SELECT filename, duration_seconds
               FROM note_audio_files
               WHERE note_id = ?
                 AND filename IN (${filenames.map(() => "?").join(",")})
               ORDER BY recorded_at DESC, id DESC
               LIMIT 1`
            )
            .get(note.id, ...filenames);
          if (latest) updateLatest.run(latest.filename, latest.duration_seconds, note.id);
        }

        return inserted;
      });

      const inserted = transaction();
      return { success: true, inserted };
    } catch (error) {
      debugLogger.error(
        "Error backfilling note audio files from directory",
        { error: error.message },
        "notes"
      );
      throw error;
    }
  }

  addNoteAudioFile(noteId, filename, durationSeconds = null, options = {}) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const safeFilename = path.basename(String(filename || ""));
      if (!safeFilename || safeFilename !== filename || !isRetainedAudioFile(safeFilename)) {
        return { success: false, error: "Invalid audio filename" };
      }

      const recordedAt = options.recordedAt || new Date().toISOString();
      const insert = this.db.prepare(
        `INSERT OR IGNORE INTO note_audio_files
          (note_id, filename, duration_seconds, recorded_at)
         VALUES (?, ?, ?, ?)`
      );
      const fetch = this.db.prepare(
        "SELECT * FROM note_audio_files WHERE note_id = ? AND filename = ?"
      );

      const transaction = this.db.transaction(() => {
        insert.run(noteId, safeFilename, durationSeconds, recordedAt);
        if (options.updateLatest) {
          this.db
            .prepare(
              `UPDATE notes
               SET source_file = ?,
                   audio_duration_seconds = ?,
                   updated_at = CURRENT_TIMESTAMP,
                   sync_status = 'pending'
               WHERE id = ?`
            )
            .run(safeFilename, durationSeconds, noteId);
        }
        return fetch.get(noteId, safeFilename);
      });

      return { success: true, audioFile: transaction() };
    } catch (error) {
      debugLogger.error("Error adding note audio file", { error: error.message }, "notes");
      throw error;
    }
  }

  getNoteAudioFiles(noteId) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db
        .prepare(
          `SELECT * FROM note_audio_files
           WHERE note_id = ?
           ORDER BY COALESCE(recorded_at, created_at) DESC, id DESC`
        )
        .all(noteId);
    } catch (error) {
      debugLogger.error("Error getting note audio files", { error: error.message }, "notes");
      throw error;
    }
  }

  getNoteAudioFile(noteId, audioFileId) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return (
        this.db
          .prepare("SELECT * FROM note_audio_files WHERE note_id = ? AND id = ?")
          .get(noteId, audioFileId) || null
      );
    } catch (error) {
      debugLogger.error("Error getting note audio file", { error: error.message }, "notes");
      throw error;
    }
  }

  removeNoteAudioFilesByFilename(filenames, remainingFilenames = null) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const names = [...new Set((filenames || []).filter(Boolean))];
      if (names.length === 0) return { success: true, affectedNotes: 0 };

      const placeholders = names.map(() => "?").join(", ");
      const remaining = remainingFilenames
        ? new Set((remainingFilenames || []).filter(Boolean))
        : null;

      const transaction = this.db.transaction(() => {
        const affected = this.db
          .prepare(
            `SELECT DISTINCT note_id
             FROM note_audio_files
             WHERE filename IN (${placeholders})`
          )
          .all(...names)
          .map((row) => row.note_id);

        this.db
          .prepare(`DELETE FROM note_audio_files WHERE filename IN (${placeholders})`)
          .run(...names);

        for (const noteId of affected) {
          const note = this.db.prepare("SELECT * FROM notes WHERE id = ?").get(noteId);
          if (!note || !names.includes(note.source_file)) continue;

          const candidates = this.db
            .prepare(
              `SELECT filename, duration_seconds
               FROM note_audio_files
               WHERE note_id = ?
               ORDER BY COALESCE(recorded_at, created_at) DESC, id DESC`
            )
            .all(noteId);
          const fallback = remaining
            ? candidates.find((candidate) => remaining.has(candidate.filename))
            : candidates[0];

          this.db
            .prepare(
              `UPDATE notes
               SET source_file = ?,
                   audio_duration_seconds = ?,
                   updated_at = CURRENT_TIMESTAMP,
                   sync_status = 'pending'
               WHERE id = ?`
            )
            .run(fallback?.filename || null, fallback?.duration_seconds || null, noteId);
        }

        return affected.length;
      });

      return { success: true, affectedNotes: transaction() };
    } catch (error) {
      debugLogger.error("Error removing note audio files", { error: error.message }, "notes");
      throw error;
    }
  }

  replaceNoteAudioFilesWithMergedFile(
    noteId,
    oldFilenames,
    mergedFilename,
    durationSeconds = null,
    options = {}
  ) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const safeMergedFilename = path.basename(String(mergedFilename || ""));
      if (
        !safeMergedFilename ||
        safeMergedFilename !== mergedFilename ||
        !isRetainedAudioFile(safeMergedFilename)
      ) {
        return { success: false, error: "Invalid merged audio filename" };
      }

      const names = [...new Set((oldFilenames || []).filter(Boolean))];
      const invalidOldName = names.find(
        (filename) =>
          path.basename(String(filename || "")) !== filename || !isRetainedAudioFile(filename)
      );
      if (invalidOldName) {
        return { success: false, error: "Invalid source audio filename" };
      }

      const recordedAt = options.recordedAt || new Date().toISOString();
      const transaction = this.db.transaction(() => {
        if (names.length > 0) {
          const placeholders = names.map(() => "?").join(", ");
          this.db
            .prepare(
              `DELETE FROM note_audio_files
               WHERE note_id = ?
                 AND filename IN (${placeholders})`
            )
            .run(noteId, ...names);
        }

        this.db
          .prepare(
            `INSERT OR REPLACE INTO note_audio_files
              (note_id, filename, duration_seconds, recorded_at)
             VALUES (?, ?, ?, ?)`
          )
          .run(noteId, safeMergedFilename, durationSeconds, recordedAt);

        this.db
          .prepare(
            `UPDATE notes
             SET source_file = ?,
                 audio_duration_seconds = ?,
                 updated_at = CURRENT_TIMESTAMP,
                 sync_status = 'pending'
             WHERE id = ?`
          )
          .run(safeMergedFilename, durationSeconds, noteId);

        return this.db
          .prepare("SELECT * FROM note_audio_files WHERE note_id = ? AND filename = ?")
          .get(noteId, safeMergedFilename);
      });

      return { success: true, audioFile: transaction() };
    } catch (error) {
      debugLogger.error("Error replacing note audio files", { error: error.message }, "notes");
      throw error;
    }
  }

  replaceNoteAudioFilename(oldFilename, newFilename) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const safeOldFilename = path.basename(String(oldFilename || ""));
      const safeNewFilename = path.basename(String(newFilename || ""));
      if (
        !safeOldFilename ||
        !safeNewFilename ||
        safeOldFilename !== oldFilename ||
        safeNewFilename !== newFilename ||
        !isRetainedAudioFile(safeOldFilename) ||
        !isRetainedAudioFile(safeNewFilename)
      ) {
        return { success: false, error: "Invalid audio filename", affectedNotes: 0 };
      }

      const transaction = this.db.transaction(() => {
        const rows = this.db
          .prepare(
            `SELECT note_id, duration_seconds, recorded_at, created_at
             FROM note_audio_files
             WHERE filename = ?`
          )
          .all(safeOldFilename);

        for (const row of rows) {
          this.db
            .prepare(
              `DELETE FROM note_audio_files
               WHERE note_id = ?
                 AND filename = ?`
            )
            .run(row.note_id, safeOldFilename);
          this.db
            .prepare(
              `INSERT OR REPLACE INTO note_audio_files
                (note_id, filename, duration_seconds, recorded_at)
               VALUES (?, ?, ?, ?)`
            )
            .run(
              row.note_id,
              safeNewFilename,
              row.duration_seconds,
              row.recorded_at || row.created_at || new Date().toISOString()
            );
        }

        this.db
          .prepare(
            `UPDATE notes
             SET source_file = ?,
                 updated_at = CURRENT_TIMESTAMP,
                 sync_status = 'pending'
             WHERE source_file = ?`
          )
          .run(safeNewFilename, safeOldFilename);

        return [...new Set(rows.map((row) => row.note_id))];
      });

      const affectedNoteIds = transaction();
      return { success: true, affectedNotes: affectedNoteIds.length, affectedNoteIds };
    } catch (error) {
      debugLogger.error("Error replacing note audio filename", { error: error.message }, "notes");
      throw error;
    }
  }

  clearNoteAudioFiles() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const transaction = this.db.transaction(() => {
        const filenames = this.db
          .prepare("SELECT DISTINCT filename FROM note_audio_files")
          .all()
          .map((row) => row.filename);
        this.db.prepare("DELETE FROM note_audio_files").run();
        if (filenames.length > 0) {
          const placeholders = filenames.map(() => "?").join(", ");
          this.db
            .prepare(
              `UPDATE notes
               SET source_file = NULL,
                   audio_duration_seconds = NULL,
                   updated_at = CURRENT_TIMESTAMP,
                   sync_status = 'pending'
               WHERE source_file IN (${placeholders})`
            )
            .run(...filenames);
        }
      });
      transaction();
      return { success: true };
    } catch (error) {
      debugLogger.error("Error clearing note audio files", { error: error.message }, "notes");
      throw error;
    }
  }

  getFolders() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db
        .prepare(
          "SELECT * FROM folders WHERE deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC"
        )
        .all();
    } catch (error) {
      debugLogger.error("Error getting folders", { error: error.message }, "notes");
      throw error;
    }
  }

  createFolder(name) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const trimmed = (name || "").trim();
      if (!trimmed) return { success: false, error: "Folder name is required" };
      const existing = this.db.prepare("SELECT id FROM folders WHERE name = ?").get(trimmed);
      if (existing) return { success: false, error: "A folder with that name already exists" };
      const maxOrder = this.db.prepare("SELECT MAX(sort_order) as max_order FROM folders").get();
      const sortOrder = (maxOrder?.max_order ?? 0) + 1;
      const clientFolderId = randomUUID();
      const result = this.db
        .prepare("INSERT INTO folders (name, sort_order, client_folder_id) VALUES (?, ?, ?)")
        .run(trimmed, sortOrder, clientFolderId);
      const folder = this.db
        .prepare("SELECT * FROM folders WHERE id = ?")
        .get(result.lastInsertRowid);
      return { success: true, folder };
    } catch (error) {
      debugLogger.error("Error creating folder", { error: error.message }, "notes");
      throw error;
    }
  }

  deleteFolder(id) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const folder = this.db.prepare("SELECT * FROM folders WHERE id = ?").get(id);
      if (!folder) return { success: false, error: "Folder not found" };
      if (folder.is_default) return { success: false, error: "Cannot delete default folders" };
      const noteIds = this.db
        .prepare("SELECT id FROM notes WHERE folder_id = ?")
        .all(id)
        .map((row) => row.id);
      for (const noteId of noteIds) {
        try {
          require("./noteAssetStorage").cleanupNoteAssetFiles(this, noteId);
        } catch (cleanupError) {
          debugLogger.warn(
            "Failed to clean up note assets before deleting folder",
            { noteId, folderId: id, error: cleanupError.message },
            "notes"
          );
        }
      }
      // Server cascades note deletes on folder delete; sync pull picks up note tombstones.
      const hardDeleteNotes = this.db.prepare("DELETE FROM notes WHERE folder_id = ?");
      const tombstoneFolder = this.db.prepare(
        "UPDATE folders SET deleted_at = datetime('now'), updated_at = datetime('now'), sync_status = 'pending', name = '__deleted_' || id || '_' || name WHERE id = ?"
      );
      const hardDeleteFolder = this.db.prepare("DELETE FROM folders WHERE id = ?");
      this.db.transaction(() => {
        hardDeleteNotes.run(id);
        if (folder.cloud_id) tombstoneFolder.run(id);
        else hardDeleteFolder.run(id);
      })();
      return { success: true, id, noteIds };
    } catch (error) {
      debugLogger.error("Error deleting folder", { error: error.message }, "notes");
      throw error;
    }
  }

  renameFolder(id, name) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const folder = this.db.prepare("SELECT * FROM folders WHERE id = ?").get(id);
      if (!folder) return { success: false, error: "Folder not found" };
      if (folder.is_default) return { success: false, error: "Cannot rename default folders" };
      const trimmed = (name || "").trim();
      if (!trimmed) return { success: false, error: "Folder name is required" };
      const existing = this.db
        .prepare("SELECT id FROM folders WHERE name = ? AND id != ?")
        .get(trimmed, id);
      if (existing) return { success: false, error: "A folder with that name already exists" };
      this.db
        .prepare(
          "UPDATE folders SET name = ?, sync_status = 'pending', updated_at = datetime('now') WHERE id = ?"
        )
        .run(trimmed, id);
      const updated = this.db.prepare("SELECT * FROM folders WHERE id = ?").get(id);
      return { success: true, folder: updated };
    } catch (error) {
      debugLogger.error("Error renaming folder", { error: error.message }, "notes");
      throw error;
    }
  }

  reorderFolders(folderIds) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const existingIds = this.db
        .prepare("SELECT id FROM folders WHERE deleted_at IS NULL")
        .all()
        .map((row) => row.id);
      let plan;
      try {
        plan = buildFolderReorderPlan(existingIds, folderIds);
      } catch (error) {
        return { success: false, error: error.message };
      }

      const update = this.db.prepare(
        "UPDATE folders SET sort_order = ?, sync_status = 'pending', updated_at = datetime('now') WHERE id = ?"
      );
      this.db.transaction(() => {
        for (const { id, sortOrder } of plan) {
          update.run(sortOrder, id);
        }
      })();
      return { success: true, folders: this.getFolders() };
    } catch (error) {
      debugLogger.error("Error reordering folders", { error: error.message }, "notes");
      throw error;
    }
  }

  getFolderNoteCounts() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db
        .prepare(
          "SELECT folder_id, COUNT(*) as count FROM notes WHERE deleted_at IS NULL GROUP BY folder_id"
        )
        .all();
    } catch (error) {
      debugLogger.error("Error getting folder note counts", { error: error.message }, "notes");
      throw error;
    }
  }

  _insertDefaultAction(action) {
    const outputTarget = action.tracking ? "tracking" : "content";
    return this.db
      .prepare(
        "INSERT INTO actions (name, description, prompt, icon, output_target, write_mode, is_builtin, sort_order, translation_key) VALUES (?, ?, ?, ?, ?, 'overwrite', ?, ?, ?)"
      )
      .run(
        action.name,
        action.description,
        action.prompt,
        "sparkles",
        outputTarget,
        action.isBuiltin,
        action.sortOrder,
        action.key
      );
  }

  _seedTrackingTemplates() {
    const templates = [
      [
        "商机",
        {
          fields: ["客户", "金额", "负责人"],
          states: ["进行中", "赢单", "输单", "暂停"],
          updateTypes: ["进展", "风险", "结果", "下一步", "关联"],
        },
      ],
      [
        "项目",
        {
          fields: ["客户", "负责人"],
          states: ["进行中", "已完成", "暂停"],
          updateTypes: ["进展", "风险", "结果", "下一步", "关联"],
        },
      ],
      [
        "产品能力",
        {
          fields: ["产品线", "负责人"],
          states: ["建设中", "已形成", "已验证"],
          updateTypes: ["进展", "风险", "结果", "下一步", "关联"],
        },
      ],
      [
        "生态合作项目",
        {
          fields: ["合作方", "负责人"],
          states: ["进行中", "已完成", "暂停"],
          updateTypes: ["进展", "风险", "结果", "下一步", "关联"],
        },
      ],
    ];
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO tracking_templates (name, definition_json) VALUES (?, ?)"
    );
    for (const [name, definition] of templates) insert.run(name, JSON.stringify(definition));
  }

  _updateActionToDefault(id, action) {
    const outputTarget = action.tracking ? "tracking" : "content";
    this.db
      .prepare(
        "UPDATE actions SET name = ?, description = ?, prompt = ?, icon = 'sparkles', output_target = ?, write_mode = 'overwrite', is_builtin = ?, sort_order = ?, translation_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      )
      .run(
        action.name,
        action.description,
        action.prompt,
        outputTarget,
        action.isBuiltin,
        action.sortOrder,
        action.key,
        id
      );
  }

  _updateActionDefaultMetadata(id, action) {
    if (action.tracking) {
      this.db
        .prepare(
          "UPDATE actions SET icon = 'sparkles', is_builtin = ?, sort_order = ?, translation_key = ?, output_target = 'tracking' WHERE id = ?"
        )
        .run(action.isBuiltin, action.sortOrder, action.key, id);
      return;
    }
    this.db
      .prepare(
        "UPDATE actions SET icon = 'sparkles', is_builtin = ?, sort_order = ?, translation_key = ? WHERE id = ?"
      )
      .run(action.isBuiltin, action.sortOrder, action.key, id);
  }

  _seedDefaultActions() {
    const actionCount = this.db.prepare("SELECT COUNT(*) as count FROM actions").get();
    const meetingAction = DEFAULT_NOTE_ACTIONS[0];

    if (actionCount.count === 0) {
      DEFAULT_NOTE_ACTIONS.forEach((action) => this._insertDefaultAction(action));
      return;
    }

    const existingMeeting = this.db
      .prepare("SELECT id FROM actions WHERE translation_key = ?")
      .get(meetingAction.key);
    const legacyBuiltIn = this.db
      .prepare(
        "SELECT id FROM actions WHERE is_builtin = 1 ORDER BY sort_order ASC, created_at ASC LIMIT 1"
      )
      .get();

    let meetingActionId = existingMeeting?.id;
    let migratedLegacyBuiltIn = false;
    if (meetingActionId) {
      this._updateActionDefaultMetadata(meetingActionId, meetingAction);
    }
    if (!meetingActionId && legacyBuiltIn) {
      meetingActionId = legacyBuiltIn.id;
      migratedLegacyBuiltIn = true;
      this._updateActionToDefault(meetingActionId, meetingAction);
    }

    if (!meetingActionId) return;

    this.db
      .prepare("UPDATE actions SET is_builtin = 0 WHERE id != ? AND is_builtin = 1")
      .run(meetingActionId);

    for (const action of DEFAULT_NOTE_ACTIONS.slice(1)) {
      const existing = this.db
        .prepare("SELECT id FROM actions WHERE translation_key = ?")
        .get(action.key);
      if (!existing) {
        this._insertDefaultAction(action);
      } else if (action.tracking) {
        this.db
          .prepare("UPDATE actions SET is_builtin = 1, output_target = 'tracking' WHERE id = ?")
          .run(existing.id);
      }
    }
  }

  getActions() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db.prepare("SELECT * FROM actions ORDER BY sort_order ASC, created_at ASC").all();
    } catch (error) {
      debugLogger.error("Error getting actions", { error: error.message }, "notes");
      throw error;
    }
  }

  getAction(id) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db.prepare("SELECT * FROM actions WHERE id = ?").get(id) || null;
    } catch (error) {
      debugLogger.error("Error getting action", { error: error.message }, "notes");
      throw error;
    }
  }

  getTrackingTemplates() {
    return this.db
      .prepare("SELECT * FROM tracking_templates ORDER BY id ASC")
      .all()
      .map((row) => ({ ...row, definition: safeJson(row.definition_json, {}) }));
  }

  listTrackingItems({ search = "", templateId = null, state = "", active = "all", page = 1 } = {}) {
    if (
      typeof search !== "string" ||
      typeof state !== "string" ||
      !["all", "active", "inactive"].includes(active) ||
      !Number.isSafeInteger(page) ||
      page < 1 ||
      (templateId !== null && (!Number.isSafeInteger(templateId) || templateId < 1))
    )
      throw new Error("Invalid tracking query");
    const where = ["instr(lower(i.title), lower(?)) > 0"];
    const params = [search.trim()];
    if (templateId !== null) {
      where.push("i.template_id = ?");
      params.push(templateId);
    }
    const states = this.db
      .prepare(
        `SELECT DISTINCT i.state FROM tracking_items i WHERE ${where.join(" AND ")} ORDER BY i.state`
      )
      .all(...params)
      .map((r) => r.state);
    if (state) {
      where.push("i.state = ?");
      params.push(state);
    }
    if (active !== "all") {
      where.push("i.is_active = ?");
      params.push(active === "active" ? 1 : 0);
    }
    const clause = where.join(" AND ");
    const total = this.db
      .prepare(`SELECT COUNT(*) AS count FROM tracking_items i WHERE ${clause}`)
      .get(...params).count;
    const items = this.db
      .prepare(
        `SELECT i.*, t.name AS itemType,
      u.content AS latestContent, u.created_at AS latestRecordedAt
      FROM tracking_items i JOIN tracking_templates t ON t.id = i.template_id
      LEFT JOIN tracking_updates u ON u.id = (SELECT id FROM tracking_updates WHERE item_id = i.id ORDER BY created_at DESC, id DESC LIMIT 1)
      WHERE ${clause} ORDER BY i.updated_at DESC, i.id DESC LIMIT 30 OFFSET ?`
      )
      .all(...params, (page - 1) * 30)
      .map((row) => ({
        ...row,
        properties: safeJson(row.properties_json, {}),
        isActive: !!row.is_active,
      }));
    return { items, total, states, page };
  }

  _getTrackingItem(itemId) {
    if (!Number.isSafeInteger(itemId) || itemId < 1) throw new Error("Invalid tracking query");
    const row = this.db
      .prepare(
        `SELECT i.*, t.name AS itemType FROM tracking_items i
      JOIN tracking_templates t ON t.id = i.template_id WHERE i.id = ?`
      )
      .get(itemId);
    if (!row) throw new Error("Tracking item not found");
    return { ...row, properties: safeJson(row.properties_json, {}), isActive: !!row.is_active };
  }

  getTrackingItemDetail(itemId, { page = 1, updateType = "", from = "", to = "" } = {}) {
    if (!Number.isSafeInteger(page) || page < 1 || typeof updateType !== "string")
      throw new Error("Invalid tracking query");
    if (
      typeof from !== "string" ||
      typeof to !== "string" ||
      (from && (from.length !== 10 || trackingDay(from) !== from)) ||
      (to && (to.length !== 10 || trackingDay(to) !== to)) ||
      (from && to && from > to)
    )
      throw new Error("Invalid date range");
    const item = this._getTrackingItem(itemId);
    const row = item;
    const params = updateType ? [itemId, updateType] : [itemId];
    let where = "u.item_id = ?" + (updateType ? " AND u.update_type = ?" : "");
    if (from) {
      where += " AND (tracking_day(u.occurred_at) IS NULL OR tracking_day(u.occurred_at) >= ?)";
      params.push(from);
    }
    if (to) {
      where += " AND (tracking_day(u.occurred_at) IS NULL OR tracking_day(u.occurred_at) <= ?)";
      params.push(to);
    }
    const total = this.db
      .prepare(`SELECT COUNT(*) AS count FROM tracking_updates u WHERE ${where}`)
      .get(...params).count;
    const updates = this.db
      .prepare(
        `SELECT u.*, tracking_day(u.occurred_at) IS NULL AS unknown_date, n.title AS note_title, n.deleted_at AS note_deleted_at
      FROM tracking_updates u LEFT JOIN notes n ON n.id = u.note_id WHERE ${where}
      ORDER BY unknown_date ASC, u.created_at DESC, u.id DESC LIMIT 30 OFFSET ?`
      )
      .all(...params, (page - 1) * 30);
    const noteIds = new Set(
      this.db
        .prepare("SELECT DISTINCT note_id FROM tracking_updates WHERE item_id = ?")
        .all(itemId)
        .map((r) => r.note_id)
    );
    const unique =
      this.db
        .prepare("SELECT COUNT(*) AS count FROM tracking_items WHERE title = ? AND template_id = ?")
        .get(row.title, row.template_id).count === 1;
    // Legacy extraction-only links have no indexed item ID. Parse latest confirmed snapshots once.
    for (const extraction of this.db
      .prepare(
        `SELECT e.note_id, e.result_json FROM tracking_extractions e
      WHERE e.status = 'confirmed' AND e.id = (SELECT MAX(id) FROM tracking_extractions WHERE note_id = e.note_id AND status = 'confirmed')`
      )
      .all()) {
      const result = safeJson(extraction.result_json, {});
      if (
        [...(result.newItems || []), ...(result.matchedItems || [])].some(
          (entry) =>
            entry.itemId === itemId ||
            (entry.itemId == null &&
              unique &&
              entry.title === row.title &&
              entry.itemType === row.itemType)
        )
      )
        noteIds.add(extraction.note_id);
    }
    const notes = noteIds.size
      ? this.db
          .prepare(
            "SELECT id, title, folder_id, deleted_at FROM notes WHERE id IN (SELECT value FROM json_each(?))"
          )
          .all(JSON.stringify([...noteIds]))
      : [];
    for (const id of noteIds)
      if (!notes.some((note) => note.id === id))
        notes.push({ id, title: null, deleted_at: "missing", folder_id: null });
    const relations = this.db
      .prepare(
        `SELECT u.*, a.title AS source_title, b.title AS target_title
      FROM tracking_updates u JOIN tracking_items a ON a.id = u.item_id
      JOIN tracking_items b ON b.id = u.related_item_id WHERE u.item_id = ? OR u.related_item_id = ? ORDER BY u.id DESC`
      )
      .all(itemId, itemId);
    const operations = this.db
      .prepare("SELECT * FROM tracking_operations WHERE item_id = ? ORDER BY id DESC LIMIT 30")
      .all(itemId);
    return { item, updates: { items: updates, total, page }, notes, relations, operations };
  }

  getTrackingCandidates(noteId, includeInactive = false) {
    const note = this.getNote(noteId);
    if (!note || note.deleted_at) throw new Error("Note not found");
    const items = this.db
      .prepare(
        `SELECT i.*, t.name AS itemType FROM tracking_items i
      JOIN tracking_templates t ON t.id = i.template_id
      WHERE (? = 1 OR i.is_active = 1) ORDER BY i.updated_at DESC, i.id DESC`
      )
      .all(includeInactive ? 1 : 0)
      .map((item) => ({
        id: item.id,
        title: item.title,
        itemType: item.itemType,
        state: item.state,
        properties: safeJson(item.properties_json, {}),
        isActive: !!item.is_active,
        stateSourceUpdateId: item.state_source_update_id,
      }));
    const linked = new Set(
      this.db
        .prepare("SELECT DISTINCT item_id FROM tracking_updates WHERE note_id = ?")
        .all(noteId)
        .map((row) => row.item_id)
    );
    const last = this.db
      .prepare(
        "SELECT result_json FROM tracking_extractions WHERE note_id = ? AND status = 'confirmed' ORDER BY id DESC LIMIT 1"
      )
      .get(noteId);
    const previous = safeJson(last?.result_json, {});
    for (const entry of [...(previous.matchedItems || []), ...(previous.newItems || [])]) {
      if (Number.isInteger(entry.itemId)) linked.add(entry.itemId);
      else {
        const matches = items.filter(
          (item) => item.title === entry.title && item.itemType === entry.itemType
        );
        if (matches.length === 1) linked.add(matches[0].id);
      }
    }
    // The review picker must expose every active item of the proposed type.
    // Candidate recall is a user choice, so hiding items by text similarity makes
    // valid merges impossible when the note uses an alias or a short description.
    return [
      ...items.filter((item) => linked.has(item.id)).map((item) => ({ ...item, linked: true })),
      ...items.filter((item) => !linked.has(item.id)).map((item) => ({ ...item, linked: false })),
    ];
  }

  normalizeTrackingResult(result) {
    const items = this.db
      .prepare(
        `SELECT i.id, i.title, t.name AS itemType FROM tracking_items i
      JOIN tracking_templates t ON t.id = i.template_id`
      )
      .all();
    return normalizeTrackingDraft(result, items);
  }

  getTrackingTemplateVersion() {
    return this.db
      .prepare("SELECT COALESCE(MAX(version), 1) AS version FROM tracking_templates")
      .get().version;
  }

  trackingInputHash(note, action) {
    return (
      "v3:" +
      createHash("sha256")
        .update(
          JSON.stringify({
            title: note.title,
            content: note.content,
            enhanced: note.enhanced_content,
            transcript: note.transcript,
            recordedAt: note.recorded_at,
            tags: note.tags,
            action,
            templates: this.getTrackingTemplates(),
          })
        )
        .digest("hex")
    );
  }

  prepareTrackingExtraction(noteId, actionId) {
    if (!Number.isSafeInteger(noteId) || !Number.isSafeInteger(actionId))
      throw new Error("Invalid note or action ID");
    const note = this.getNote(noteId);
    const action = this.getAction(actionId);
    if (!note || note.deleted_at || !action || action.output_target !== "tracking")
      throw new Error("Tracking note or action unavailable");
    return {
      note,
      action,
      templates: this.getTrackingTemplates(),
      inputHash: this.trackingInputHash(note, action),
    };
  }

  trackingExtractionStale(row) {
    if (!row || !row.input_hash.startsWith("v3:")) return true;
    try {
      return (
        row.input_hash !== this.prepareTrackingExtraction(row.note_id, row.action_id).inputHash
      );
    } catch {
      return true;
    }
  }

  trackingReviewSnapshot(noteId) {
    // ponytail: hash the local item ledger; narrow to reviewed targets if the ledger becomes large.
    return createHash("sha256")
      .update(
        JSON.stringify({
          items: this.db.prepare("SELECT * FROM tracking_items ORDER BY id").all(),
          updates: this.db
            .prepare("SELECT * FROM tracking_updates WHERE note_id = ? ORDER BY id")
            .all(noteId),
        })
      )
      .digest("hex");
  }

  getNoteTrackingSummaries(noteIds, actionId = null) {
    if (
      !Array.isArray(noteIds) ||
      noteIds.length > 10000 ||
      noteIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
    )
      throw new Error("Invalid note IDs (maximum 10000)");
    if (!noteIds.length) return [];
    const rows = this.db
      .prepare(
        `SELECT e.* FROM tracking_extractions e
      WHERE e.note_id IN (${noteIds.map(() => "?").join(",")})
      ORDER BY e.id DESC`
      )
      .all(...noteIds);
    return noteIds.map((noteId) => {
      const latest = rows.find((e) => e.note_id === noteId);
      const confirmed = rows.some((e) => e.note_id === noteId && e.status === "confirmed");
      const stale = latest
        ? this.trackingExtractionStale(latest) ||
          (actionId != null && latest.action_id !== actionId)
        : false;
      return {
        noteId,
        extractionId: latest?.id ?? null,
        hasConfirmed: confirmed,
        stale,
        status: !latest ? "notExtracted" : stale ? "stale" : latest.status,
      };
    });
  }

  listTrackingSourceNotes({ from, to, actionId, page = 1, selection = false } = {}) {
    if (
      typeof from !== "string" ||
      typeof to !== "string" ||
      !Number.isFinite(Date.parse(from)) ||
      !Number.isFinite(Date.parse(to)) ||
      Date.parse(from) >= Date.parse(to) ||
      !Number.isSafeInteger(page) ||
      page < 1
    )
      throw new Error("Invalid date range or page");
    const action = this.getAction(actionId);
    if (!Number.isSafeInteger(actionId) || !action || action.output_target !== "tracking")
      throw new Error("Tracking action unavailable");
    const rows = this.db
      .prepare(
        `SELECT id, title, folder_id,
      COALESCE(recorded_at, created_at) AS recordedAt,
      CASE WHEN trim(COALESCE(content,'')) != '' OR trim(COALESCE(transcript,'')) != ''
        THEN 1 ELSE 0 END AS eligible
      FROM notes WHERE deleted_at IS NULL
      AND julianday(COALESCE(recorded_at, created_at)) >= julianday(?)
      AND julianday(COALESCE(recorded_at, created_at)) < julianday(?)
      ORDER BY julianday(COALESCE(recorded_at, created_at)), id`
      )
      .all(from, to);
    if (rows.length > 10000) throw new Error("Too many notes; choose a smaller date range");
    const visible = selection ? rows : rows.slice((page - 1) * 50, page * 50);
    const summaries = new Map(
      this.getNoteTrackingSummaries(
        visible.map((n) => n.id),
        actionId
      ).map((s) => [s.noteId, s])
    );
    return {
      total: rows.length,
      page,
      items: visible.map((n) => ({ ...n, ...summaries.get(n.id) })),
    };
  }

  listPendingTrackingNotes({ page = 1 } = {}) {
    if (!Number.isSafeInteger(page) || page < 1) throw new Error("Invalid page");
    const condition = `FROM tracking_extractions e JOIN notes n ON n.id=e.note_id
      WHERE n.deleted_at IS NULL AND e.status='pending'
      AND e.id=(SELECT MAX(id) FROM tracking_extractions WHERE note_id=e.note_id)`;
    const total = this.db.prepare("SELECT COUNT(*) AS count " + condition).get().count;
    const rows = this.db
      .prepare(
        `SELECT e.*, n.title, n.folder_id,
      COALESCE(n.recorded_at,n.created_at) AS recordedAt ${condition}
      ORDER BY e.id DESC LIMIT 50 OFFSET ?`
      )
      .all((page - 1) * 50);
    return {
      total,
      page,
      items: rows.map((row) => {
        const result = safeJson(row.result_json, {});
        return {
          id: row.note_id,
          extractionId: row.id,
          title: row.title,
          folder_id: row.folder_id,
          recordedAt: row.recordedAt,
          stale: this.trackingExtractionStale(row),
          itemCount: (result.newItems?.length || 0) + (result.matchedItems?.length || 0),
          updateCount: result.updates?.length || 0,
        };
      }),
    };
  }

  getTrackingExtraction(noteId, actionId) {
    const note = this.getNote(noteId);
    if (!note || note.deleted_at) return null;
    const action = this.getAction(actionId);
    if (!action || action.output_target !== "tracking") return null;
    const templateVersion = this.getTrackingTemplateVersion();
    const inputHash = this.trackingInputHash(note, action);
    const row = this.db
      .prepare(
        `SELECT * FROM tracking_extractions
         WHERE note_id = ? AND action_id = ? AND input_hash = ? AND template_version = ?
           AND status IN ('pending', 'confirmed')
           AND id = (SELECT MAX(e.id) FROM tracking_extractions e WHERE e.note_id = tracking_extractions.note_id)
         ORDER BY id DESC LIMIT 1`
      )
      .get(noteId, actionId, inputHash, templateVersion);
    return row
      ? { ...row, result: safeJson(row.result_json, null), inputHash, templateVersion }
      : null;
  }

  saveTrackingExtraction(noteId, actionId, generatedContent, force = false, requestHash) {
    const note = this.getNote(noteId);
    const action = this.getAction(actionId);
    if (!note || note.deleted_at || !action || action.output_target !== "tracking") {
      return { success: false, error: "Tracking action or note not found" };
    }
    let result;
    try {
      const cleaned = String(generatedContent || "")
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
      result = JSON.parse(cleaned);
    } catch {
      return { success: false, error: "Tracking extraction returned invalid JSON" };
    }
    if (!result || typeof result !== "object" || !Array.isArray(result.updates)) {
      return { success: false, error: "Tracking extraction has an invalid shape" };
    }
    try {
      // A model cannot authorize creating an item: only the review UI can set createNew.
      for (const key of ["matchedItems", "newItems"]) {
        if (Array.isArray(result[key]))
          result[key] = result[key].map(({ createNew: _ignored, ...item }) => item);
      }
      result = this.normalizeTrackingResult(result);
      result.protocolVersion = 2;
    } catch (error) {
      return { success: false, error: error.message };
    }
    const templateVersion = this.getTrackingTemplateVersion();
    const inputHash = requestHash || this.trackingInputHash(note, action);
    if (!/^v3:[a-f0-9]{64}$/.test(inputHash))
      return { success: false, error: "Invalid tracking request fingerprint" };
    if (!force && inputHash === this.trackingInputHash(note, action)) {
      const cached = this.getTrackingExtraction(noteId, actionId);
      if (cached?.result?.protocolVersion === 2)
        return { success: true, cached: true, extraction: cached };
    }
    const previous = this.db
      .prepare(
        `SELECT * FROM tracking_extractions
         WHERE note_id = ? AND action_id = ? AND status IN ('pending', 'confirmed')
         ORDER BY id DESC LIMIT 1`
      )
      .get(noteId, actionId);
    const row = this.db
      .prepare(
        `INSERT INTO tracking_extractions
          (note_id, action_id, input_hash, template_version, result_json, status, supersedes_id)
         VALUES (?, ?, ?, ?, ?, 'pending', ?)`
      )
      .run(
        noteId,
        actionId,
        inputHash,
        templateVersion,
        JSON.stringify(result),
        previous?.id || null
      );
    return {
      success: true,
      cached: false,
      extraction: {
        id: row.lastInsertRowid,
        note_id: noteId,
        action_id: actionId,
        input_hash: inputHash,
        template_version: templateVersion,
        status: "pending",
        supersedes_id: previous?.id || null,
        result,
      },
    };
  }

  getNoteTracking(noteId) {
    const extractions = this.db
      .prepare("SELECT * FROM tracking_extractions WHERE note_id = ? ORDER BY id DESC")
      .all(noteId)
      .map((row) => ({ ...row, result: safeJson(row.result_json, null) }));
    const updates = this.db
      .prepare(
        `SELECT u.*, i.title AS item_title, i.state AS item_state,
                t.name AS item_type
         FROM tracking_updates u
         JOIN tracking_items i ON i.id = u.item_id
         JOIN tracking_templates t ON t.id = i.template_id
         WHERE u.note_id = ? ORDER BY u.occurred_at DESC, u.id DESC`
      )
      .all(noteId);
    const all = this.getTrackingCandidates(noteId, true);
    const candidates = all.filter((item) => item.isActive);
    const items = all.filter((item) => item.linked);
    return {
      items,
      noteId,
      reviewSnapshot: this.trackingReviewSnapshot(noteId),
      extractions: extractions.map((extraction) => {
        try {
          return {
            ...extraction,
            stale: this.trackingExtractionStale(extraction),
            reviewResult: this.normalizeTrackingResult(extraction.result),
          };
        } catch {
          return { ...extraction, stale: true, reviewResult: null };
        }
      }),
      updates,
      candidates,
    };
  }

  confirmTrackingExtraction(extractionId, resultOverride, review) {
    const extraction = this.db
      .prepare("SELECT * FROM tracking_extractions WHERE id = ?")
      .get(extractionId);
    if (!extraction) return { success: false, error: "Tracking extraction not found" };
    if (extraction.status === "confirmed") return { success: true, alreadyConfirmed: true };
    if (extraction.status !== "pending")
      return { success: false, error: "Extraction is not pending" };
    if (
      this.getTrackingExtraction(extraction.note_id, extraction.action_id)?.id !== extraction.id
    ) {
      return {
        success: false,
        error: "Note or extraction changed; extract again before confirming",
      };
    }
    let result = resultOverride || safeJson(extraction.result_json, null);
    if (!result || !Array.isArray(result.updates)) {
      return { success: false, error: "Tracking extraction has an invalid result" };
    }
    try {
      result = this.normalizeTrackingResult(result);
    } catch (error) {
      return { success: false, error: error.message };
    }
    const templates = new Map(
      this.getTrackingTemplates().map((template) => [template.name, template])
    );
    const findOrCreateItem = (item) => {
      const title = String(item?.title || item?.itemTitle || "").trim();
      const type = String(item?.itemType || "").trim();
      if (!title || !templates.has(type)) throw new Error("Unknown item type or empty title");
      if (item.itemId != null) {
        if (!Number.isInteger(item.itemId)) throw new Error("Invalid item ID");
        const existing = this.db
          .prepare("SELECT * FROM tracking_items WHERE id = ?")
          .get(item.itemId);
        if (!existing || existing.template_id !== templates.get(type).id)
          throw new Error("Item ID does not exist or type does not match");
        return existing;
      }
      if (item.createNew !== true)
        throw new Error("Choose an existing item or explicitly choose to create a new item");
      const normalized = (value) =>
        String(value).normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, "");
      const duplicate = this.db
        .prepare("SELECT id, title FROM tracking_items WHERE template_id=?")
        .all(templates.get(type).id)
        .find((entry) => normalized(entry.title) === normalized(title));
      if (duplicate)
        throw new Error(
          `Existing item #${duplicate.id}: ${duplicate.title}; choose it instead of creating a duplicate`
        );
      const inserted = this.db
        .prepare(
          "INSERT INTO tracking_items (template_id, title, state, properties_json) VALUES (?, ?, ?, ?)"
        )
        .run(
          templates.get(type).id,
          title,
          item?.state || "进行中",
          JSON.stringify(item?.properties || {})
        );
      return this.db
        .prepare("SELECT * FROM tracking_items WHERE id = ?")
        .get(inserted.lastInsertRowid);
    };
    const transaction = this.db.transaction(() => {
      if (review && review.expected !== this.trackingReviewSnapshot(extraction.note_id))
        throw new Error("Tracking data changed; reload the review");
      if (
        review &&
        !review.replaceUpdates &&
        this.db
          .prepare("SELECT 1 FROM tracking_updates WHERE note_id=? LIMIT 1")
          .get(extraction.note_id)
      )
        throw new Error("Confirm replacement of this note's saved updates");
      const affected = this.db
        .prepare("SELECT DISTINCT item_id FROM tracking_updates WHERE note_id = ?")
        .all(extraction.note_id);
      // Previous reviewed JSON is kept for audit; only this note's materialized updates are replaced.
      this.db.prepare("DELETE FROM tracking_updates WHERE note_id = ?").run(extraction.note_id);
      const itemByRef = new Map();
      for (const item of [...(result.matchedItems || []), ...(result.newItems || [])]) {
        const created = findOrCreateItem(item);
        itemByRef.set(item.ref, created);
        item.itemId = created.id;
        item.title = created.title;
        delete item.createNew;
      }
      // Relations are source-backed updates too; no separate graph table is needed.
      for (const relation of result.relations || []) {
        result.updates.push({
          itemRef: relation.sourceRef,
          relatedItemRef: relation.targetRef,
          relationType: relation.relationType,
          updateType: "关联",
          content: relation.content || relation.relationType,
          evidence: relation.evidence,
          occurredAt: relation.occurredAt || null,
        });
      }
      for (const update of result.updates) {
        const item = itemByRef.get(update.itemRef);
        if (!item || typeof update.content !== "string" || !update.content.trim()) {
          throw new Error("Every update must reference a valid item and contain text");
        }
        const related = itemByRef.get(update.relatedItemRef) || null;
        update.itemId = item.id;
        update.itemTitle = item.title;
        if (related) {
          update.relatedItemId = related.id;
          update.relatedItemTitle = related.title;
        }
        this.db
          .prepare(
            `INSERT INTO tracking_updates
              (item_id, note_id, update_type, content, occurred_at, state_after, evidence_text, related_item_id, relation_type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            item.id,
            extraction.note_id,
            update.updateType || "进展",
            update.content.trim(),
            update.occurredAt || null,
            update.stateAfter || null,
            update.evidence || "",
            related?.id || null,
            update.relationType || null
          );
        this.db
          .prepare(
            "UPDATE tracking_items SET state = CASE WHEN manual_state = 1 THEN state ELSE COALESCE(?, state) END, state_source_update_id = CASE WHEN manual_state = 0 AND ? IS NOT NULL THEN last_insert_rowid() ELSE state_source_update_id END, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
          )
          .run(update.stateAfter || null, update.stateAfter || null, item.id);
      }
      for (const { item_id } of affected) {
        const source = this.db
          .prepare("SELECT state_source_update_id FROM tracking_items WHERE id = ?")
          .get(item_id)?.state_source_update_id;
        if (
          source == null ||
          this.db.prepare("SELECT id FROM tracking_updates WHERE id = ?").get(source)
        )
          continue;
        const state = this.db
          .prepare(
            "SELECT id, state_after FROM tracking_updates WHERE item_id = ? AND state_after IS NOT NULL ORDER BY id DESC LIMIT 1"
          )
          .get(item_id);
        const item = this.db
          .prepare("SELECT template_id FROM tracking_items WHERE id = ?")
          .get(item_id);
        const template = [...templates.values()].find((t) => t.id === item?.template_id);
        this.db
          .prepare(
            "UPDATE tracking_items SET state = ?, state_source_update_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND manual_state = 0"
          )
          .run(
            state?.state_after || template?.definition?.states?.[0] || "进行中",
            state?.id || null,
            item_id
          );
      }
      this.db
        .prepare(
          "UPDATE tracking_extractions SET status = 'superseded', updated_at = CURRENT_TIMESTAMP WHERE note_id = ? AND id != ? AND status IN ('pending', 'confirmed')"
        )
        .run(extraction.note_id, extractionId);
      this.db
        .prepare(
          "UPDATE tracking_extractions SET result_json = ?, status = 'confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        )
        .run(JSON.stringify({ ...result, protocolVersion: 2 }), extractionId);
    });
    try {
      transaction();
    } catch (error) {
      return { success: false, error: error.message };
    }
    return { success: true, data: this.getNoteTracking(extraction.note_id) };
  }

  updateTrackingItem(itemId, { expected, patch } = {}) {
    try {
      if (!patch || typeof patch !== "object" || !Object.keys(patch).length)
        throw new Error("No changes supplied");
      const data = this.db.transaction(() => {
        const before = this._getTrackingItem(itemId);
        if (!expected || !isDeepStrictEqual(expected, before))
          throw new Error("Tracking record changed; read again before editing");
        this._saveTrackingItem(
          itemId,
          patch,
          { state: before.state, stateSource: before.state_source_update_id },
          "center"
        );
        return this.getTrackingItemDetail(itemId);
      })();
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  _saveTrackingItem(itemId, itemPatch, { state, stateSource }, entrypoint) {
    const item = this._getTrackingItem(itemId);
    const allowed = ["title", "state", "properties", "removePropertyKeys", "isActive"];
    if (
      !itemPatch ||
      typeof itemPatch !== "object" ||
      Array.isArray(itemPatch) ||
      Object.keys(itemPatch).some((key) => !allowed.includes(key))
    )
      throw new Error("Invalid tracking fields");
    for (const key of ["title", "state"]) {
      if (
        Object.hasOwn(itemPatch, key) &&
        (typeof itemPatch[key] !== "string" || !itemPatch[key].trim())
      )
        throw new Error("Invalid tracking value");
    }
    const template = this.getTrackingTemplates().find((t) => t.id === item.template_id);
    if (
      itemPatch.state &&
      itemPatch.state !== item.state &&
      !template.definition.states.includes(itemPatch.state)
    )
      throw new Error("Invalid item state");
    if (Object.hasOwn(itemPatch, "isActive") && typeof itemPatch.isActive !== "boolean")
      throw new Error("Invalid tracking value");
    if (
      Object.hasOwn(itemPatch, "properties") &&
      (!itemPatch.properties ||
        typeof itemPatch.properties !== "object" ||
        Array.isArray(itemPatch.properties))
    )
      throw new Error("Invalid properties");
    const removed = itemPatch.removePropertyKeys ?? [];
    if (
      !Array.isArray(removed) ||
      removed.some(
        (key) => typeof key !== "string" || !key || Object.hasOwn(itemPatch.properties || {}, key)
      )
    )
      throw new Error("Invalid property removal");
    const properties = { ...item.properties, ...itemPatch.properties };
    for (const key of removed) delete properties[key];
    // Backfill legacy identity before renaming; keep all extracted text unchanged.
    if (itemPatch.title && itemPatch.title !== item.title) {
      const unique =
        this.db
          .prepare(
            `SELECT COUNT(*) AS count FROM tracking_items i
            JOIN tracking_templates t ON t.id = i.template_id WHERE i.title = ? AND t.name = ?`
          )
          .get(item.title, item.itemType).count === 1;
      if (unique) {
        for (const row of this.db
          .prepare("SELECT id, result_json FROM tracking_extractions WHERE status = 'confirmed'")
          .all()) {
          const result = safeJson(row.result_json, {});
          let changed = false;
          for (const entry of [...(result.matchedItems || []), ...(result.newItems || [])]) {
            if (
              entry.itemId == null &&
              entry.title === item.title &&
              entry.itemType === item.itemType
            ) {
              entry.itemId = itemId;
              changed = true;
            }
          }
          if (changed)
            this.db
              .prepare("UPDATE tracking_extractions SET result_json = ? WHERE id = ?")
              .run(JSON.stringify(result), row.id);
        }
      }
    }

    const explicitState = Object.hasOwn(itemPatch, "state");
    this.db
      .prepare(
        `UPDATE tracking_items SET title = ?, state = ?, properties_json = ?, is_active = ?,
      state_source_update_id = ?, manual_state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      )
      .run(
        itemPatch.title?.trim() ?? item.title,
        itemPatch.state ?? state,
        JSON.stringify(properties),
        Number(itemPatch.isActive ?? item.isActive),
        explicitState ? null : stateSource,
        explicitState ? 1 : item.manual_state,
        itemId
      );
    const after = this._getTrackingItem(itemId);
    this.db
      .prepare(
        "INSERT INTO tracking_operations (item_id, operation, before_json, after_json, entrypoint) VALUES (?, ?, ?, ?, ?)"
      )
      .run(itemId, "edit-item", JSON.stringify(item), JSON.stringify(after), entrypoint);
  }

  updateNoteTracking(noteId, request) {
    try {
      this.db.transaction(() => {
        const { itemId, updateId, itemPatch = {}, updatePatch = {}, expected } = request;
        const tracking = this.getNoteTracking(noteId);
        const item = tracking.items.find((row) => row.id === itemId);
        const update =
          updateId == null
            ? null
            : tracking.updates.find((row) => row.id === updateId && row.item_id === itemId);
        if (!item || (updateId != null && !update))
          throw new Error("Tracking record not linked to current note");
        if (
          !expected ||
          JSON.stringify(expected.item) !== JSON.stringify(item) ||
          JSON.stringify(expected.update ?? null) !== JSON.stringify(update)
        )
          throw new Error("Tracking record changed; read again before editing");
        const validatePatch = (patch, allowed) => {
          if (
            !patch ||
            typeof patch !== "object" ||
            Array.isArray(patch) ||
            Object.keys(patch).some((key) => !allowed.includes(key))
          )
            throw new Error("Invalid tracking fields");
        };
        validatePatch(itemPatch, ["title", "state", "properties"]);
        validatePatch(updatePatch, ["content", "update_type", "occurred_at", "state_after"]);
        if (!Object.keys(itemPatch).length && !Object.keys(updatePatch).length)
          throw new Error("No changes supplied");
        if (Object.keys(updatePatch).length && !update) throw new Error("Progress ID required");
        for (const [key, value] of [...Object.entries(itemPatch), ...Object.entries(updatePatch)]) {
          if (key === "properties") {
            if (!value || typeof value !== "object" || Array.isArray(value))
              throw new Error("Invalid properties");
          } else if (
            !(value === null && ["occurred_at", "state_after"].includes(key)) &&
            (typeof value !== "string" || !value.trim())
          )
            throw new Error("Invalid tracking value");
        }
        const template = this.getTrackingTemplates().find((t) => t.name === item.itemType);
        if (
          updatePatch.update_type &&
          !template.definition.updateTypes.includes(updatePatch.update_type)
        )
          throw new Error("Invalid progress type");
        if (updatePatch.occurred_at && !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(updatePatch.occurred_at))
          throw new Error("Use an ISO date");
        if (updatePatch.occurred_at && !Number.isFinite(Date.parse(updatePatch.occurred_at)))
          throw new Error("Invalid date");
        let state = item.state;
        let stateSource = item.stateSourceUpdateId;
        if (update && Object.hasOwn(updatePatch, "state_after")) {
          const latest = this.db
            .prepare(
              "SELECT id, state_after FROM tracking_updates WHERE item_id = ? AND state_after IS NOT NULL ORDER BY id DESC LIMIT 1"
            )
            .get(itemId);
          if (latest?.id === updateId && item.stateSourceUpdateId === updateId) {
            const previous = this.db
              .prepare(
                "SELECT id, state_after FROM tracking_updates WHERE item_id = ? AND id != ? AND state_after IS NOT NULL ORDER BY id DESC LIMIT 1"
              )
              .get(itemId, updateId);
            state =
              updatePatch.state_after || previous?.state_after || template.definition.states[0];
            stateSource = updatePatch.state_after ? updateId : previous?.id || null;
          }
        }
        this._saveTrackingItem(itemId, itemPatch, { state, stateSource }, "note");
        if (update) {
          const next = { ...update, ...updatePatch };
          this.db
            .prepare(
              "UPDATE tracking_updates SET content = ?, update_type = ?, occurred_at = ?, state_after = ? WHERE id = ?"
            )
            .run(next.content, next.update_type, next.occurred_at, next.state_after, updateId);
        }
      })();
      return { success: true, data: this.getNoteTracking(noteId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  rejectTrackingExtraction(extractionId) {
    const result = this.db
      .prepare(
        "UPDATE tracking_extractions SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'"
      )
      .run(extractionId);
    return { success: result.changes > 0 };
  }

  getTrackingContext({
    from = null,
    to = null,
    itemTypes = [],
    itemIds = [],
    includeInactive = false,
  } = {}) {
    const conditions = ["1 = 1"];
    const params = [];
    if (!includeInactive) conditions.push("i.is_active = 1");
    if (from) {
      conditions.push("(u.occurred_at IS NULL OR u.occurred_at >= ?)");
      params.push(from);
    }
    if (to) {
      conditions.push("(u.occurred_at IS NULL OR u.occurred_at <= ?)");
      params.push(to);
    }
    if (itemTypes.length) {
      conditions.push(`t.name IN (${itemTypes.map(() => "?").join(",")})`);
      params.push(...itemTypes);
    }
    if (itemIds.length) {
      conditions.push(`i.id IN (${itemIds.map(() => "?").join(",")})`);
      params.push(...itemIds);
    }
    const rows = this.db
      .prepare(
        `
      SELECT i.id, i.title, i.state, i.properties_json, t.name AS item_type,
             u.id AS update_id, u.update_type, u.content, u.occurred_at, u.state_after, u.evidence_text,
             u.note_id, u.related_item_id, u.relation_type
      FROM tracking_items i
      JOIN tracking_templates t ON t.id = i.template_id
      LEFT JOIN tracking_updates u ON u.item_id = i.id
      WHERE ${conditions.join(" AND ")}
      ORDER BY COALESCE(u.occurred_at, i.updated_at) DESC, i.id DESC, u.id DESC
    `
      )
      .all(...params);
    const items = new Map();
    for (const row of rows) {
      if (!items.has(row.id))
        items.set(row.id, {
          id: row.id,
          title: row.title,
          type: row.item_type,
          state: row.state,
          properties: safeJson(row.properties_json, {}),
          updates: [],
          relations: [],
        });
      const item = items.get(row.id);
      if (row.update_id)
        item.updates.push({
          id: row.update_id,
          type: row.update_type,
          content: row.content,
          occurred_at: row.occurred_at,
          state_after: row.state_after,
          evidence: row.evidence_text,
          note_id: row.note_id,
        });
      if (row.related_item_id)
        item.relations.push({ item_id: row.related_item_id, type: row.relation_type });
    }
    return { from, to, items: [...items.values()] };
  }

  createAction(name, description, prompt, icon = "sparkles", options = {}) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const trimmedName = (name || "").trim();
      const trimmedPrompt = (prompt || "").trim();
      if (!trimmedName) return { success: false, error: "Action name is required" };
      if (!trimmedPrompt) return { success: false, error: "Action prompt is required" };
      const actionOptions = options || {};
      const outputTarget =
        actionOptions.output_target === "enhanced_content" ? "enhanced_content" : "content";
      const writeMode = actionOptions.write_mode === "append" ? "append" : "overwrite";
      const maxOrder = this.db.prepare("SELECT MAX(sort_order) as max_order FROM actions").get();
      const sortOrder = (maxOrder?.max_order ?? 0) + 1;
      const result = this.db
        .prepare(
          "INSERT INTO actions (name, description, prompt, icon, output_target, write_mode, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          trimmedName,
          (description || "").trim(),
          trimmedPrompt,
          icon || "sparkles",
          outputTarget,
          writeMode,
          sortOrder
        );
      const action = this.db
        .prepare("SELECT * FROM actions WHERE id = ?")
        .get(result.lastInsertRowid);
      return { success: true, action };
    } catch (error) {
      debugLogger.error("Error creating action", { error: error.message }, "notes");
      throw error;
    }
  }

  updateAction(id, updates) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const allowedFields = [
        "name",
        "description",
        "prompt",
        "icon",
        "sort_order",
        "output_target",
        "write_mode",
      ];
      const existingAction = this.db.prepare("SELECT * FROM actions WHERE id = ?").get(id);
      const fields = [];
      const values = [];
      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key) && value !== undefined) {
          if (
            key === "output_target" &&
            (value === "tracking"
              ? !existingAction?.is_builtin ||
                existingAction.translation_key !== "notes.actions.builtin.extractTracking"
              : !["content", "enhanced_content"].includes(value))
          ) {
            continue;
          }
          if (key === "write_mode" && !["overwrite", "append"].includes(value)) {
            continue;
          }
          fields.push(`${key} = ?`);
          values.push(value);
        }
      }
      if (fields.length === 0) return { success: false };
      fields.push("updated_at = CURRENT_TIMESTAMP");
      values.push(id);
      this.db.prepare(`UPDATE actions SET ${fields.join(", ")} WHERE id = ?`).run(...values);
      const action = this.db.prepare("SELECT * FROM actions WHERE id = ?").get(id);
      return { success: true, action };
    } catch (error) {
      debugLogger.error("Error updating action", { error: error.message }, "notes");
      throw error;
    }
  }

  deleteAction(id) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const action = this.db.prepare("SELECT * FROM actions WHERE id = ?").get(id);
      if (!action) return { success: false, error: "Action not found" };
      if (action.is_builtin) return { success: false, error: "Cannot delete built-in actions" };
      this.db.prepare("DELETE FROM actions WHERE id = ?").run(id);
      return { success: true, id };
    } catch (error) {
      debugLogger.error("Error deleting action", { error: error.message }, "notes");
      throw error;
    }
  }

  deleteNote(id) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      try {
        require("./noteAssetStorage").cleanupNoteAssetFiles(this, id);
      } catch (cleanupError) {
        debugLogger.warn(
          "Failed to clean up note assets before deleting note",
          { noteId: id, error: cleanupError.message },
          "notes"
        );
      }
      const stmt = this.db.prepare(
        "UPDATE notes SET deleted_at = datetime('now'), sync_status = 'pending', updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL"
      );
      const result = stmt.run(id);
      return { success: result.changes > 0, id };
    } catch (error) {
      debugLogger.error("Error deleting note", { error: error.message }, "notes");
      throw error;
    }
  }

  createNoteAsset({ id, noteId, filename, storedFilename, mimeType, sizeBytes }) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      this.db
        .prepare(
          `INSERT INTO note_assets
            (id, note_id, filename, stored_filename, mime_type, size_bytes)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(id, noteId, filename, storedFilename, mimeType, sizeBytes);
      return this.getNoteAsset(id);
    } catch (error) {
      debugLogger.error("Error creating note asset", { error: error.message }, "database");
      throw error;
    }
  }

  getNoteAsset(id) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db.prepare("SELECT * FROM note_assets WHERE id = ?").get(id) || null;
    } catch (error) {
      debugLogger.error("Error getting note asset", { error: error.message }, "database");
      throw error;
    }
  }

  getNoteAssets(noteId) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db
        .prepare("SELECT * FROM note_assets WHERE note_id = ? ORDER BY created_at ASC")
        .all(noteId);
    } catch (error) {
      debugLogger.error("Error getting note assets", { error: error.message }, "database");
      throw error;
    }
  }

  deleteNoteAsset(id) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const result = this.db.prepare("DELETE FROM note_assets WHERE id = ?").run(id);
      return { success: result.changes > 0 };
    } catch (error) {
      debugLogger.error("Error deleting note asset", { error: error.message }, "database");
      throw error;
    }
  }

  createAgentConversation(title = "Untitled", noteId = null) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const clientConversationId = randomUUID();
      const result = this.db
        .prepare(
          "INSERT INTO agent_conversations (title, note_id, client_conversation_id) VALUES (?, ?, ?)"
        )
        .run(title, noteId, clientConversationId);
      return this.db
        .prepare("SELECT * FROM agent_conversations WHERE id = ?")
        .get(result.lastInsertRowid);
    } catch (error) {
      debugLogger.error("Error creating agent conversation", { error: error.message }, "database");
      throw error;
    }
  }

  getConversationsForNote(noteId, limit = 20) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db
        .prepare(
          `SELECT c.id, c.title, c.created_at, c.updated_at,
            COUNT(m.id) AS message_count
          FROM agent_conversations c
          LEFT JOIN agent_messages m ON m.conversation_id = c.id
          WHERE c.note_id = ?
          GROUP BY c.id
          ORDER BY c.updated_at DESC
          LIMIT ?`
        )
        .all(noteId, limit);
    } catch (error) {
      debugLogger.error(
        "Error getting conversations for note",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  getAgentConversations(limit = 50) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db
        .prepare(
          "SELECT * FROM agent_conversations WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?"
        )
        .all(limit);
    } catch (error) {
      debugLogger.error("Error getting agent conversations", { error: error.message }, "database");
      throw error;
    }
  }

  getAgentConversation(id) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const conversation = this.db
        .prepare("SELECT * FROM agent_conversations WHERE id = ?")
        .get(id);
      if (!conversation) return null;
      const messages = this.db
        .prepare("SELECT * FROM agent_messages WHERE conversation_id = ? ORDER BY created_at ASC")
        .all(id);
      return { ...conversation, messages };
    } catch (error) {
      debugLogger.error("Error getting agent conversation", { error: error.message }, "database");
      throw error;
    }
  }

  deleteAgentConversation(id) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const result = this.db
        .prepare(
          "UPDATE agent_conversations SET deleted_at = datetime('now'), sync_status = 'pending', updated_at = datetime('now') WHERE id = ?"
        )
        .run(id);
      return { success: result.changes > 0 };
    } catch (error) {
      debugLogger.error("Error deleting agent conversation", { error: error.message }, "database");
      throw error;
    }
  }

  updateAgentConversationTitle(id, title) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      this.db
        .prepare(
          "UPDATE agent_conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        )
        .run(title, id);
      return { success: true };
    } catch (error) {
      debugLogger.error(
        "Error updating agent conversation title",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  addAgentMessage(conversationId, role, content, metadata) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const metadataStr = metadata ? JSON.stringify(metadata) : null;
      const result = this.db
        .prepare(
          "INSERT INTO agent_messages (conversation_id, role, content, metadata) VALUES (?, ?, ?, ?)"
        )
        .run(conversationId, role, content, metadataStr);
      this.db
        .prepare("UPDATE agent_conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(conversationId);
      return this.db
        .prepare("SELECT * FROM agent_messages WHERE id = ?")
        .get(result.lastInsertRowid);
    } catch (error) {
      debugLogger.error("Error adding agent message", { error: error.message }, "database");
      throw error;
    }
  }

  getAgentMessages(conversationId) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db
        .prepare("SELECT * FROM agent_messages WHERE conversation_id = ? ORDER BY created_at ASC")
        .all(conversationId);
    } catch (error) {
      debugLogger.error("Error getting agent messages", { error: error.message }, "database");
      throw error;
    }
  }

  searchNotes(query, limit = 50, tags = []) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const rawTerm = query.trim();
      if (!rawTerm) return [];
      const term = rawTerm
        .trim()
        .replace(/[^\w\s]/g, " ")
        .trim();
      const tagNames = this.normalizeTagNames(tags);
      const tagFilter = tagNames.length
        ? `AND n.id IN (
            SELECT nt.note_id
            FROM note_tags nt
            JOIN tags t ON t.id = nt.tag_id
            WHERE LOWER(t.name) IN (${tagNames.map(() => "?").join(", ")})
          )`
        : "";
      const tagParams = tagNames.map((name) => name.toLocaleLowerCase());
      const notesById = new Map();
      const addNotes = (notes) => {
        for (const note of notes) {
          if (notesById.size >= limit) break;
          if (!notesById.has(note.id)) notesById.set(note.id, note);
        }
      };
      const runFtsSearch = () => {
        if (!term) return [];
        return this.db
          .prepare(
            `
        SELECT n.*
        FROM notes n
        JOIN notes_fts ON notes_fts.rowid = n.id
        WHERE notes_fts MATCH ? AND n.deleted_at IS NULL
        ${tagFilter}
        ORDER BY notes_fts.rank
        LIMIT ?
      `
          )
          .all(term + "*", ...tagParams, limit);
      };
      const runLikeSearch = () => {
        const escaped = rawTerm.replace(/[\\%_]/g, (match) => `\\${match}`);
        const pattern = `%${escaped}%`;
        return this.db
          .prepare(
            `
        SELECT n.*
        FROM notes n
        WHERE n.deleted_at IS NULL
          AND (
            n.title LIKE ? ESCAPE '\\'
            OR n.content LIKE ? ESCAPE '\\'
            OR n.enhanced_content LIKE ? ESCAPE '\\'
          )
        ${tagFilter}
        ORDER BY n.updated_at DESC, n.created_at DESC
        LIMIT ?
      `
          )
          .all(pattern, pattern, pattern, ...tagParams, limit);
      };
      const preferLike = /[^\x00-\x7F]/.test(rawTerm) || rawTerm !== term;
      const searches = preferLike ? [runLikeSearch, runFtsSearch] : [runFtsSearch, runLikeSearch];
      for (const search of searches) addNotes(search());
      return this.attachTags([...notesById.values()]);
    } catch (error) {
      debugLogger.error("Error searching notes", { error: error.message }, "database");
      throw error;
    }
  }

  upsertContacts(contacts) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const transaction = this.db.transaction((list) => {
        const stmt = this.db.prepare(
          "INSERT INTO contacts (email, display_name, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(email) DO UPDATE SET display_name = COALESCE(excluded.display_name, contacts.display_name), updated_at = CURRENT_TIMESTAMP"
        );
        for (const c of list) {
          if (c.email) stmt.run(c.email.toLowerCase().trim(), c.displayName || null);
        }
      });
      transaction(contacts);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error upserting contacts", { error: error.message }, "database");
      throw error;
    }
  }

  searchContacts(query) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const pattern = `%${query || ""}%`;
      return this.db
        .prepare(
          "SELECT * FROM contacts WHERE email LIKE ? OR display_name LIKE ? ORDER BY display_name ASC, email ASC LIMIT 20"
        )
        .all(pattern, pattern);
    } catch (error) {
      debugLogger.error("Error searching contacts", { error: error.message }, "database");
      throw error;
    }
  }

  getMeetingsFolder() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return (
        this.db
          .prepare("SELECT id FROM folders WHERE name = 'Meetings' AND is_default = 1")
          .get() || null
      );
    } catch (error) {
      debugLogger.error("Error getting meetings folder", { error: error.message }, "meeting");
      throw error;
    }
  }

  updateNoteCloudId(id, cloudId) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      this.db.prepare("UPDATE notes SET cloud_id = ? WHERE id = ?").run(cloudId, id);
      return this.db.prepare("SELECT * FROM notes WHERE id = ?").get(id);
    } catch (error) {
      debugLogger.error("Error updating note cloud_id", { error: error.message }, "database");
      throw error;
    }
  }

  cleanup() {
    try {
      if (this.db) {
        try {
          this.db.close();
        } catch (closeError) {
          debugLogger.error("Error closing database", { error: closeError.message }, "database");
        }
        this.db = null;
      }
      const dbPath =
        this.dbPath ||
        path.join(
          app.getPath("userData"),
          process.env.NODE_ENV === "development" ? "transcriptions-dev.db" : "transcriptions.db"
        );
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
    } catch (error) {
      debugLogger.error("Error deleting database file", { error: error.message }, "database");
    }
  }
  getAgentConversationsWithPreview(limit = 50, offset = 0, includeArchived = false) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const archiveFilter = includeArchived
        ? "WHERE c.archived_at IS NOT NULL AND c.deleted_at IS NULL"
        : "WHERE c.archived_at IS NULL AND c.deleted_at IS NULL";
      return this.db
        .prepare(
          `SELECT c.id, c.title, c.created_at, c.updated_at, c.archived_at, c.cloud_id,
            COUNT(m.id) AS message_count,
            (SELECT content FROM agent_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
            (SELECT role FROM agent_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_role
          FROM agent_conversations c
          LEFT JOIN agent_messages m ON m.conversation_id = c.id
          ${archiveFilter}
          GROUP BY c.id
          ORDER BY c.updated_at DESC
          LIMIT ? OFFSET ?`
        )
        .all(limit, offset);
    } catch (error) {
      debugLogger.error(
        "Error getting agent conversations with preview",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  searchAgentConversations(query, limit = 20) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const pattern = `%${query}%`;
      return this.db
        .prepare(
          `SELECT DISTINCT c.id, c.title, c.created_at, c.updated_at, c.archived_at, c.cloud_id,
            COUNT(m.id) AS message_count,
            (SELECT content FROM agent_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
            (SELECT role FROM agent_messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_role
          FROM agent_conversations c
          LEFT JOIN agent_messages m ON m.conversation_id = c.id
          LEFT JOIN agent_messages ms ON ms.conversation_id = c.id
          WHERE c.archived_at IS NULL AND c.deleted_at IS NULL
            AND (c.title LIKE ? OR ms.content LIKE ?)
          GROUP BY c.id
          ORDER BY c.updated_at DESC
          LIMIT ?`
        )
        .all(pattern, pattern, limit);
    } catch (error) {
      debugLogger.error(
        "Error searching agent conversations",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  archiveAgentConversation(id) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      this.db
        .prepare("UPDATE agent_conversations SET archived_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(id);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error archiving agent conversation", { error: error.message }, "database");
      throw error;
    }
  }

  unarchiveAgentConversation(id) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      this.db.prepare("UPDATE agent_conversations SET archived_at = NULL WHERE id = ?").run(id);
      return { success: true };
    } catch (error) {
      debugLogger.error(
        "Error unarchiving agent conversation",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  updateAgentConversationCloudId(id, cloudId) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      this.db.prepare("UPDATE agent_conversations SET cloud_id = ? WHERE id = ?").run(cloudId, id);
      return { success: true };
    } catch (error) {
      debugLogger.error(
        "Error updating agent conversation cloud_id",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  _normalizeEmail(email) {
    const trimmed = (email || "").trim().toLowerCase();
    return trimmed || null;
  }

  _findProfileByEmail(email) {
    const normalized = this._normalizeEmail(email);
    if (!normalized) return null;
    return this.db.prepare("SELECT * FROM speaker_profiles WHERE lower(email) = ?").get(normalized);
  }

  upsertSpeakerProfile(name, email, embeddingBuffer, profileId = null) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const normalizedEmail = this._normalizeEmail(email);
      let existing = profileId
        ? this.db.prepare("SELECT * FROM speaker_profiles WHERE id = ?").get(profileId)
        : null;
      if (!existing && normalizedEmail) {
        existing = this._findProfileByEmail(normalizedEmail);
      }
      if (!existing) {
        existing = this.db
          .prepare("SELECT * FROM speaker_profiles WHERE display_name = ?")
          .get(name);
      }
      if (existing) {
        const stored = new Float32Array(
          existing.embedding.buffer,
          existing.embedding.byteOffset,
          existing.embedding.byteLength / 4
        );
        const incoming = new Float32Array(
          embeddingBuffer.buffer,
          embeddingBuffer.byteOffset,
          embeddingBuffer.byteLength / 4
        );
        const updated = new Float32Array(stored.length);
        for (let i = 0; i < stored.length; i++) {
          updated[i] = 0.3 * incoming[i] + 0.7 * stored[i];
        }
        const updatedBuf = Buffer.from(updated.buffer);
        const finalEmail = normalizedEmail || existing.email || null;
        this.db
          .prepare(
            "UPDATE speaker_profiles SET display_name = ?, email = ?, embedding = ?, sample_count = sample_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
          )
          .run(name, finalEmail, updatedBuf, existing.id);
        const resolved = this.db
          .prepare("SELECT * FROM speaker_profiles WHERE id = ?")
          .get(existing.id);
        if (normalizedEmail) {
          const collision = this.db
            .prepare("SELECT * FROM speaker_profiles WHERE lower(email) = ? AND id != ?")
            .get(normalizedEmail, existing.id);
          if (collision) {
            return this.mergeSpeakerProfiles(resolved, collision);
          }
        }
        return resolved;
      }
      const result = this.db
        .prepare("INSERT INTO speaker_profiles (display_name, email, embedding) VALUES (?, ?, ?)")
        .run(name, normalizedEmail, embeddingBuffer);
      return this.db
        .prepare("SELECT * FROM speaker_profiles WHERE id = ?")
        .get(result.lastInsertRowid);
    } catch (error) {
      debugLogger.error("Error upserting speaker profile", { error: error.message }, "database");
      throw error;
    }
  }

  attachEmailToProfile(profileId, email) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const normalizedEmail = this._normalizeEmail(email);
      const profile = this.db.prepare("SELECT * FROM speaker_profiles WHERE id = ?").get(profileId);
      if (!profile) throw new Error(`Speaker profile ${profileId} not found`);

      if (!normalizedEmail) {
        this.db
          .prepare(
            "UPDATE speaker_profiles SET email = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
          )
          .run(profileId);
        return this.db.prepare("SELECT * FROM speaker_profiles WHERE id = ?").get(profileId);
      }

      const collision = this._findProfileByEmail(normalizedEmail);
      if (collision && collision.id !== profileId) {
        return this.mergeSpeakerProfiles(collision, profile);
      }

      this.db
        .prepare(
          "UPDATE speaker_profiles SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        )
        .run(normalizedEmail, profileId);
      return this.db.prepare("SELECT * FROM speaker_profiles WHERE id = ?").get(profileId);
    } catch (error) {
      debugLogger.error(
        "Error attaching email to speaker profile",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  mergeSpeakerProfiles(a, b) {
    const winner = (a.sample_count || 0) >= (b.sample_count || 0) ? a : b;
    const loser = winner === a ? b : a;

    const winnerEmb = new Float32Array(
      winner.embedding.buffer,
      winner.embedding.byteOffset,
      winner.embedding.byteLength / 4
    );
    const loserEmb = new Float32Array(
      loser.embedding.buffer,
      loser.embedding.byteOffset,
      loser.embedding.byteLength / 4
    );
    const wSamples = winner.sample_count || 1;
    const lSamples = loser.sample_count || 1;
    const total = wSamples + lSamples;
    const blended = new Float32Array(winnerEmb.length);
    for (let i = 0; i < winnerEmb.length; i++) {
      blended[i] = (winnerEmb[i] * wSamples + loserEmb[i] * lSamples) / total;
    }

    const finalEmail = winner.email || loser.email || null;
    const finalName = winner.display_name || loser.display_name;

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE speaker_profiles SET display_name = ?, email = ?, embedding = ?, sample_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        )
        .run(finalName, finalEmail, Buffer.from(blended.buffer), total, winner.id);
      this.db
        .prepare(
          "UPDATE speaker_mappings SET profile_id = ?, display_name = ? WHERE profile_id = ?"
        )
        .run(winner.id, finalName, loser.id);
      this.db.prepare("DELETE FROM speaker_profiles WHERE id = ?").run(loser.id);
    });
    tx();

    return this.db.prepare("SELECT * FROM speaker_profiles WHERE id = ?").get(winner.id);
  }

  getSpeakerProfiles(includeEmbedding = false) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const query = includeEmbedding
        ? "SELECT * FROM speaker_profiles"
        : `SELECT id, display_name, email, sample_count, created_at, updated_at
           FROM speaker_profiles`;
      return this.db.prepare(query).all();
    } catch (error) {
      debugLogger.error("Error getting speaker profiles", { error: error.message }, "database");
      throw error;
    }
  }

  getSpeakerNames() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db
        .prepare(
          `SELECT id, display_name, email, created_at, updated_at
           FROM speaker_names
           ORDER BY lower(display_name) ASC`
        )
        .all();
    } catch (error) {
      debugLogger.error("Error getting speaker names", { error: error.message }, "database");
      throw error;
    }
  }

  upsertSpeakerName(displayName, email = null) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const name = (displayName || "").trim();
      if (!name) throw new Error("Speaker name is required");
      const normalizedEmail = this._normalizeEmail(email);
      const existing = this.db
        .prepare("SELECT * FROM speaker_names WHERE lower(display_name) = lower(?)")
        .get(name);

      if (existing) {
        this.db
          .prepare(
            `UPDATE speaker_names
             SET display_name = ?, email = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`
          )
          .run(name, normalizedEmail, existing.id);
        return this.db.prepare("SELECT * FROM speaker_names WHERE id = ?").get(existing.id);
      }

      const result = this.db
        .prepare("INSERT INTO speaker_names (display_name, email) VALUES (?, ?)")
        .run(name, normalizedEmail);
      return this.db
        .prepare("SELECT * FROM speaker_names WHERE id = ?")
        .get(result.lastInsertRowid);
    } catch (error) {
      debugLogger.error("Error upserting speaker name", { error: error.message }, "database");
      throw error;
    }
  }

  deleteSpeakerName(id) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      this.db.prepare("DELETE FROM speaker_names WHERE id = ?").run(id);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error deleting speaker name", { error: error.message }, "database");
      throw error;
    }
  }

  setSpeakerMapping(noteId, speakerId, profileId, displayName) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      this.db
        .prepare(
          "INSERT OR REPLACE INTO speaker_mappings (note_id, speaker_id, profile_id, display_name) VALUES (?, ?, ?, ?)"
        )
        .run(noteId, speakerId, profileId, displayName);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error setting speaker mapping", { error: error.message }, "database");
      throw error;
    }
  }

  getSpeakerMappings(noteId) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db.prepare("SELECT * FROM speaker_mappings WHERE note_id = ?").all(noteId);
    } catch (error) {
      debugLogger.error("Error getting speaker mappings", { error: error.message }, "database");
      throw error;
    }
  }

  saveNoteSpeakerEmbeddings(noteId, embeddings) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const transaction = this.db.transaction((entries) => {
        const stmt = this.db.prepare(
          "INSERT OR REPLACE INTO note_speaker_embeddings (note_id, speaker_id, embedding) VALUES (?, ?, ?)"
        );
        for (const [speakerId, buffer] of entries) {
          stmt.run(noteId, speakerId, buffer);
        }
      });
      transaction(Object.entries(embeddings));
      return { success: true };
    } catch (error) {
      debugLogger.error(
        "Error saving note speaker embeddings",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  getNoteSpeakerEmbeddings(noteId) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db.prepare("SELECT * FROM note_speaker_embeddings WHERE note_id = ?").all(noteId);
    } catch (error) {
      debugLogger.error(
        "Error getting note speaker embeddings",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  getPendingNotes() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db
        .prepare("SELECT * FROM notes WHERE sync_status = 'pending' AND deleted_at IS NULL")
        .all();
    } catch (error) {
      debugLogger.error("Error getting pending notes", { error: error.message }, "database");
      throw error;
    }
  }

  getPendingNoteDeletes() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db
        .prepare(
          "SELECT * FROM notes WHERE deleted_at IS NOT NULL AND cloud_id IS NOT NULL AND sync_status = 'pending'"
        )
        .all();
    } catch (error) {
      debugLogger.error("Error getting pending note deletes", { error: error.message }, "database");
      throw error;
    }
  }

  getNoteByClientId(clientNoteId) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return (
        this.db.prepare("SELECT * FROM notes WHERE client_note_id = ?").get(clientNoteId) || null
      );
    } catch (error) {
      debugLogger.error("Error getting note by client id", { error: error.message }, "database");
      throw error;
    }
  }

  upsertNoteFromCloud(cloudNote, localFolderId) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const stmt = this.db.prepare(`
        INSERT INTO notes (client_note_id, cloud_id, title, content, enhanced_content,
          enhancement_prompt, enhanced_at_content_hash, note_type, source_file,
          audio_duration_seconds, transcript, folder_id, participants,
          diarization_enabled, expected_speaker_count, sync_status, recorded_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?, ?)
        ON CONFLICT(client_note_id) DO UPDATE SET
          cloud_id = excluded.cloud_id,
          title = excluded.title,
          content = excluded.content,
          enhanced_content = excluded.enhanced_content,
          enhancement_prompt = excluded.enhancement_prompt,
          enhanced_at_content_hash = excluded.enhanced_at_content_hash,
          transcript = excluded.transcript,
          folder_id = excluded.folder_id,
          participants = excluded.participants,
          diarization_enabled = excluded.diarization_enabled,
          expected_speaker_count = excluded.expected_speaker_count,
          sync_status = 'synced',
          updated_at = excluded.updated_at
      `);
      stmt.run(
        cloudNote.client_note_id,
        cloudNote.id,
        cloudNote.title,
        cloudNote.content,
        cloudNote.enhanced_content || null,
        cloudNote.enhancement_prompt || null,
        cloudNote.enhanced_at_content_hash || null,
        cloudNote.note_type || "personal",
        cloudNote.source_file || null,
        cloudNote.audio_duration_seconds || null,
        cloudNote.transcript || null,
        localFolderId,
        cloudNote.participants || null,
        cloudNote.diarization_enabled ?? null,
        cloudNote.expected_speaker_count ?? null,
        cloudNote.created_at,
        cloudNote.created_at,
        cloudNote.updated_at
      );
      return this.db
        .prepare("SELECT * FROM notes WHERE client_note_id = ?")
        .get(cloudNote.client_note_id);
    } catch (error) {
      debugLogger.error("Error upserting note from cloud", { error: error.message }, "database");
      throw error;
    }
  }

  markNoteSynced(id, cloudId) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      this.db
        .prepare("UPDATE notes SET sync_status = 'synced', cloud_id = ? WHERE id = ?")
        .run(cloudId, id);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error marking note synced", { error: error.message }, "database");
      throw error;
    }
  }

  markNoteSyncError(id) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      this.db.prepare("UPDATE notes SET sync_status = 'error' WHERE id = ?").run(id);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error marking note sync error", { error: error.message }, "database");
      throw error;
    }
  }

  hardDeleteNote(id) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      try {
        require("./noteAssetStorage").cleanupNoteAssetFiles(this, id);
      } catch (cleanupError) {
        debugLogger.warn(
          "Failed to clean up note assets before hard deleting note",
          { noteId: id, error: cleanupError.message },
          "notes"
        );
      }
      const result = this.db.prepare("DELETE FROM notes WHERE id = ?").run(id);
      return { success: result.changes > 0, id };
    } catch (error) {
      debugLogger.error("Error hard deleting note", { error: error.message }, "database");
      throw error;
    }
  }

  getPendingFolders() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db
        .prepare("SELECT * FROM folders WHERE sync_status = 'pending' AND deleted_at IS NULL")
        .all();
    } catch (error) {
      debugLogger.error("Error getting pending folders", { error: error.message }, "database");
      throw error;
    }
  }

  getPendingFolderDeletes() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db
        .prepare(
          "SELECT * FROM folders WHERE deleted_at IS NOT NULL AND cloud_id IS NOT NULL AND sync_status = 'pending'"
        )
        .all();
    } catch (error) {
      debugLogger.error(
        "Error getting pending folder deletes",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  hardDeleteFolder(id) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const folder = this.db.prepare("SELECT name FROM folders WHERE id = ?").get(id);
      const noteIds = this.db
        .prepare("SELECT id FROM notes WHERE folder_id = ?")
        .all(id)
        .map((row) => row.id);
      const result = this.db.transaction(() => {
        this.db.prepare("DELETE FROM notes WHERE folder_id = ?").run(id);
        return this.db.prepare("DELETE FROM folders WHERE id = ?").run(id);
      })();
      return { success: result.changes > 0, id, noteIds, name: folder?.name ?? null };
    } catch (error) {
      debugLogger.error("Error hard deleting folder", { error: error.message }, "database");
      throw error;
    }
  }

  getFolderByClientId(clientFolderId) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return (
        this.db.prepare("SELECT * FROM folders WHERE client_folder_id = ?").get(clientFolderId) ||
        null
      );
    } catch (error) {
      debugLogger.error("Error getting folder by client id", { error: error.message }, "database");
      throw error;
    }
  }

  upsertFolderFromCloud(cloudFolder) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const stmt = this.db.prepare(`
        INSERT INTO folders (client_folder_id, cloud_id, name, is_default, sort_order, sync_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'synced', ?, ?)
        ON CONFLICT(client_folder_id) DO UPDATE SET
          cloud_id = excluded.cloud_id,
          name = excluded.name,
          sort_order = excluded.sort_order,
          sync_status = 'synced',
          updated_at = excluded.updated_at
      `);
      stmt.run(
        cloudFolder.client_folder_id,
        cloudFolder.id,
        cloudFolder.name,
        cloudFolder.is_default ? 1 : 0,
        cloudFolder.sort_order || 0,
        cloudFolder.created_at,
        cloudFolder.updated_at || cloudFolder.created_at
      );
      return this.db
        .prepare("SELECT * FROM folders WHERE client_folder_id = ?")
        .get(cloudFolder.client_folder_id);
    } catch (error) {
      debugLogger.error("Error upserting folder from cloud", { error: error.message }, "database");
      throw error;
    }
  }

  markFolderSynced(id, cloudId) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      this.db
        .prepare("UPDATE folders SET sync_status = 'synced', cloud_id = ? WHERE id = ?")
        .run(cloudId, id);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error marking folder synced", { error: error.message }, "database");
      throw error;
    }
  }

  getFolderIdMap() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db.prepare("SELECT * FROM folders WHERE deleted_at IS NULL").all();
    } catch (error) {
      debugLogger.error("Error getting folder id map", { error: error.message }, "database");
      throw error;
    }
  }

  getPendingConversations() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db
        .prepare(
          "SELECT * FROM agent_conversations WHERE sync_status = 'pending' AND deleted_at IS NULL"
        )
        .all();
    } catch (error) {
      debugLogger.error(
        "Error getting pending conversations",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  getPendingConversationDeletes() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db
        .prepare(
          "SELECT * FROM agent_conversations WHERE deleted_at IS NOT NULL AND cloud_id IS NOT NULL AND sync_status = 'pending'"
        )
        .all();
    } catch (error) {
      debugLogger.error(
        "Error getting pending conversation deletes",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  getConversationByClientId(clientId) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return (
        this.db
          .prepare("SELECT * FROM agent_conversations WHERE client_conversation_id = ?")
          .get(clientId) || null
      );
    } catch (error) {
      debugLogger.error(
        "Error getting conversation by client id",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  upsertConversationFromCloud(cloudConv, messages) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const transaction = this.db.transaction(() => {
        const convStmt = this.db.prepare(`
          INSERT INTO agent_conversations (client_conversation_id, cloud_id, title, note_id, sync_status, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'synced', ?, ?)
          ON CONFLICT(client_conversation_id) DO UPDATE SET
            cloud_id = excluded.cloud_id,
            title = excluded.title,
            note_id = excluded.note_id,
            sync_status = 'synced',
            updated_at = excluded.updated_at
        `);
        convStmt.run(
          cloudConv.client_conversation_id ?? null,
          cloudConv.id ?? null,
          cloudConv.title ?? "Untitled",
          cloudConv.note_id ?? null,
          cloudConv.created_at ?? new Date().toISOString(),
          cloudConv.updated_at ?? new Date().toISOString()
        );
        const conv = this.db
          .prepare("SELECT * FROM agent_conversations WHERE client_conversation_id = ?")
          .get(cloudConv.client_conversation_id);
        this.db.prepare("DELETE FROM agent_messages WHERE conversation_id = ?").run(conv.id);
        if (messages && messages.length > 0) {
          const msgStmt = this.db.prepare(
            "INSERT INTO agent_messages (conversation_id, role, content, metadata, created_at) VALUES (?, ?, ?, ?, ?)"
          );
          for (const msg of messages) {
            msgStmt.run(
              conv.id,
              msg.role ?? "user",
              msg.content ?? "",
              msg.metadata ? JSON.stringify(msg.metadata) : null,
              msg.created_at ?? new Date().toISOString()
            );
          }
        }
        return conv;
      });
      return transaction();
    } catch (error) {
      debugLogger.error(
        "Error upserting conversation from cloud",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  markConversationSynced(id, cloudId) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      this.db
        .prepare("UPDATE agent_conversations SET sync_status = 'synced', cloud_id = ? WHERE id = ?")
        .run(cloudId, id);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error marking conversation synced", { error: error.message }, "database");
      throw error;
    }
  }

  hardDeleteConversation(id) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      this.db.prepare("DELETE FROM agent_messages WHERE conversation_id = ?").run(id);
      const result = this.db.prepare("DELETE FROM agent_conversations WHERE id = ?").run(id);
      return { success: result.changes > 0 };
    } catch (error) {
      debugLogger.error("Error hard deleting conversation", { error: error.message }, "database");
      throw error;
    }
  }

  getPendingTranscriptions() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db
        .prepare(
          "SELECT * FROM transcriptions WHERE sync_status = 'pending' AND deleted_at IS NULL"
        )
        .all();
    } catch (error) {
      debugLogger.error(
        "Error getting pending transcriptions",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  getPendingTranscriptionDeletes() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db
        .prepare(
          "SELECT * FROM transcriptions WHERE deleted_at IS NOT NULL AND cloud_id IS NOT NULL AND sync_status = 'pending'"
        )
        .all();
    } catch (error) {
      debugLogger.error(
        "Error getting pending transcription deletes",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  hardDeleteTranscription(id) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const result = this.db.prepare("DELETE FROM transcriptions WHERE id = ?").run(id);
      return { success: result.changes > 0, id };
    } catch (error) {
      debugLogger.error("Error hard deleting transcription", { error: error.message }, "database");
      throw error;
    }
  }

  getTranscriptionByClientId(clientId) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return (
        this.db
          .prepare("SELECT * FROM transcriptions WHERE client_transcription_id = ?")
          .get(clientId) || null
      );
    } catch (error) {
      debugLogger.error(
        "Error getting transcription by client id",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  upsertTranscriptionFromCloud(cloudTranscription) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      const stmt = this.db.prepare(`
        INSERT INTO transcriptions (client_transcription_id, cloud_id, text, raw_text, status, sync_status, created_at)
        VALUES (?, ?, ?, ?, ?, 'synced', ?)
        ON CONFLICT(client_transcription_id) DO UPDATE SET
          cloud_id = excluded.cloud_id,
          text = excluded.text,
          raw_text = excluded.raw_text,
          status = excluded.status,
          sync_status = 'synced'
      `);
      stmt.run(
        cloudTranscription.client_transcription_id,
        cloudTranscription.id,
        cloudTranscription.text ?? "",
        cloudTranscription.raw_text || null,
        cloudTranscription.status || "completed",
        cloudTranscription.created_at
      );
      return this.db
        .prepare("SELECT * FROM transcriptions WHERE client_transcription_id = ?")
        .get(cloudTranscription.client_transcription_id);
    } catch (error) {
      debugLogger.error(
        "Error upserting transcription from cloud",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  markTranscriptionSynced(id, cloudId) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      this.db
        .prepare("UPDATE transcriptions SET sync_status = 'synced', cloud_id = ? WHERE id = ?")
        .run(cloudId, id);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error marking transcription synced", { error: error.message }, "database");
      throw error;
    }
  }

  getNotesWithUnmappedSpeakers() {
    try {
      if (!this.db) throw new Error("Database not initialized");
      return this.db
        .prepare(
          `SELECT DISTINCT nse.note_id
          FROM note_speaker_embeddings nse
          LEFT JOIN speaker_mappings sm ON nse.note_id = sm.note_id AND nse.speaker_id = sm.speaker_id
          WHERE sm.note_id IS NULL`
        )
        .all()
        .map((row) => row.note_id);
    } catch (error) {
      debugLogger.error(
        "Error getting notes with unmapped speakers",
        { error: error.message },
        "database"
      );
      throw error;
    }
  }

  removeSpeakerMapping(noteId, speakerId) {
    try {
      if (!this.db) throw new Error("Database not initialized");
      this.db
        .prepare("DELETE FROM speaker_mappings WHERE note_id = ? AND speaker_id = ?")
        .run(noteId, speakerId);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error removing speaker mapping", { error: error.message }, "database");
      throw error;
    }
  }
}

module.exports = DatabaseManager;
module.exports.getNoteOrderByClause = getNoteOrderByClause;
module.exports.buildFolderReorderPlan = buildFolderReorderPlan;
module.exports.buildSaveTranscriptionInsert = buildSaveTranscriptionInsert;
