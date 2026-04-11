// ─────────────────────────────────────────────────────────────────────────────
// translations.js
// Per-user language system for Sage Asian Japanese Tracker
//
// USAGE:
//   import { t, getLanguage } from './translations';
//
//   // In any component:
//   const lang = getLanguage();   // auto-reads from localStorage
//   <button>{t('logout')}</button>
//   <h2>{t('myBatches')}</h2>
// ─────────────────────────────────────────────────────────────────────────────

// Map each role → language code
// admin  → 'en'
// viewer (PHGIC) → 'en'
// setouchi / wbc / gyoumusuishin / greenservices → 'ja'
const ROLE_LANGUAGE_MAP = {
    admin:          'en',
    viewer:         'en',
    setouchi:       'ja',
    wbc:            'ja',
    gyoumusuishin:  'ja',
    greenservices:  'ja',
  };
  
  // ─── TRANSLATION DICTIONARY ──────────────────────────────────────────────────
  const translations = {
  
    // ── Auth / Login ────────────────────────────────────────────────────────────
    welcomeBack:        { en: 'Welcome back 👋',           ja: 'おかえりなさい 👋' },
    username:           { en: 'Username',                  ja: 'ユーザー名' },
    password:           { en: 'Password',                  ja: 'パスワード' },
    login:              { en: 'Login',                     ja: 'ログイン' },
    logout:             { en: 'Logout',                    ja: 'ログアウト' },
    invalidCredentials: { en: 'Invalid username or password.', ja: 'ユーザー名またはパスワードが正しくありません。' },
    loggedInAs:         { en: 'Logged in as',              ja: 'ログイン中' },
    viewOnly:           { en: 'VIEW ONLY',                 ja: '閲覧専用' },
  
    // ── Teacher Select ──────────────────────────────────────────────────────────
    selectTeacher:      { en: 'Select Teacher',            ja: '担当者を選択' },
    tapNameToContinue:  { en: 'Tap your name to continue', ja: '名前をタップして続けてください' },
    addTeacher:         { en: '+ Add Teacher',             ja: '＋ 担当者を追加' },
    chooseEmoji:        { en: 'Choose emoji',              ja: '絵文字を選択' },
    teacherName:        { en: 'Teacher name',              ja: '担当者名' },
    switch:             { en: 'Switch',                    ja: '切り替え' },
  
    // ── Batches ─────────────────────────────────────────────────────────────────
    myBatches:          { en: 'My Batches',                ja: '担当クラス一覧' },
    allBatches:         { en: 'All Batches',               ja: '全クラス一覧' },
    addNewBatch:        { en: '+ Add New Batch',           ja: '＋ 新しいクラスを追加' },
    selectedStudents:   { en: 'selected student',          ja: '名の選抜受講者' },     // used with count
    selectedStudentsPlural: { en: 'selected students',     ja: '名の選抜受講者' },
  
    // ── Students ────────────────────────────────────────────────────────────────
    students:           { en: 'Students',                  ja: '受講者一覧' },
    addStudent:         { en: '+ Add Student',             ja: '＋ 受講者を追加' },
    noStudentsFound:    { en: 'No students found.',        ja: '受講者が見つかりません。' },
    student:            { en: 'student',                   ja: '名' },            // singular with count
    studentPlural:      { en: 'students',                  ja: '名' },            // plural with count
    statusSelected:     { en: 'SELECTED',                  ja: '選抜' },
    statusRegular:      { en: 'REGULAR',                   ja: '一般' },
    printQrCodes:       { en: '🖨 Print QR Codes',         ja: '🖨 QRコードを印刷' },
  
    // ── Categories ──────────────────────────────────────────────────────────────
    categories:         { en: 'Categories',                ja: '科目' },
    category:           { en: 'category',                  ja: '科目' },
    categoryPlural:     { en: 'categories',                ja: '科目' },
    addExamCategory:    { en: 'Add Exam Category',         ja: '試験科目を追加' },
    categoryName:       { en: 'Category Name:',            ja: '科目名：' },
    categoryPlaceholder:{ en: 'e.g., Kanji, Grammar, Vocabulary', ja: '例：漢字、文法、語彙' },
  
    // ── Exams ───────────────────────────────────────────────────────────────────
    addNewExam:         { en: 'Add New Exam',              ja: '新しい試験を追加' },
    examName:           { en: 'Exam Name:',                ja: '試験名：' },
    examNamePlaceholder:{ en: 'e.g., Quiz 1, Midterm, Finals', ja: '例：小テスト１、中間試験、期末試験' },
    score:              { en: 'Score:',                    ja: '得点：' },
    totalScore:         { en: 'Total Score:',              ja: '満点：' },
    scorePlaceholder:   { en: 'e.g., 85',                  ja: '例：85' },
    totalScorePlaceholder:{ en: 'e.g., 100',               ja: '例：100' },
    date:               { en: 'Date:',                     ja: '日付：' },
    deleteExam:         { en: '🗑 Delete Exam',             ja: '🗑 試験を削除' },
    examPages:          { en: 'Exam Pages',                ja: '試験ページ' },
    page:               { en: 'Page',                      ja: 'ページ' },
    noPagesYet:         { en: 'No pages yet',              ja: 'ページがありません' },
    scanOrUpload:       { en: 'Scan or upload exam pages to get started', ja: 'スキャンまたはアップロードして開始してください' },
    tapToView:          { en: 'Tap to view',               ja: 'タップして表示' },
    scanPage:           { en: '📷 Scan Page',              ja: '📷 スキャン' },
    upload:             { en: '🖼️ Upload',                 ja: '🖼️ アップロード' },
  
    // ── Evaluation ──────────────────────────────────────────────────────────────
    newEvaluation:      { en: 'New Evaluation',            ja: '新しい評価' },
    evaluationTitle:    { en: 'Evaluation Title:',         ja: '評価タイトル：' },
    evalPlaceholder:    { en: 'e.g., Mid-term, Final, Progress Check', ja: '例：中間評価、最終評価、進捗確認' },
  
    // ── Modal / Form ─────────────────────────────────────────────────────────────
    addNewBatchModal:   { en: 'Add New Batch',             ja: '新しいクラスを追加' },
    addNewStudentModal: { en: 'Add New Student',           ja: '新しい受講者を追加' },
    editStudentModal:   { en: 'Edit Student',              ja: '受講者情報を編集' },
    name:               { en: 'Name:',                     ja: '氏名：' },
    namePlaceholder:    { en: 'e.g., Juan Cruz',           ja: '例：山田 太郎' },
    batchNamePlaceholder:{ en: 'e.g., N5 Saturday 2PM',   ja: '例：N5 土曜日 14:00' },
    status:             { en: 'Status:',                   ja: 'ステータス：' },
    statusRegularOption:{ en: 'Regular',                   ja: '一般' },
    statusSelectedOption:{ en: 'Selected',                 ja: '選抜' },
    kumiai:             { en: 'KUMIAI:',                   ja: '組合：' },
    selectKumiai:       { en: '— Select KUMIAI —',         ja: '— 組合を選択 —' },
    companyName:        { en: 'Company Name:',             ja: '会社名：' },
    companyPlaceholder: { en: 'e.g., Sunrise, Toyota...',  ja: '例：サンライズ、トヨタ…' },
    photoOptional:      { en: 'Photo (optional):',         ja: '写真（任意）：' },
    tapToUploadPhoto:   { en: 'Tap to upload photo',       ja: 'タップして写真をアップロード' },
    cancel:             { en: 'Cancel',                    ja: 'キャンセル' },
    save:               { en: 'Save',                      ja: '保存' },
    saving:             { en: 'Saving...',                 ja: '保存中...' },
  
    // ── Student Profile Actions ─────────────────────────────────────────────────
    archiveImages:      { en: '📦 Archive',                ja: '📦 アーカイブ' },
    restoreImages:      { en: '🔄 Restore',                ja: '🔄 復元' },
    hideFromKumiai:     { en: '🚫 Hide from Kumiai',       ja: '🚫 組合から非表示' },
    unarchiveStudent:   { en: '👁 Unarchive Student',      ja: '👁 アーカイブを解除' },
    deleteStudent:      { en: '🗑️ Delete',                 ja: '🗑️ 削除' },
    progress:           { en: '📈 Progress',               ja: '📈 進捗' },
  
    // ── Companies (Kumiai viewer) ────────────────────────────────────────────────
    companies:          { en: 'Companies',                 ja: '会社一覧' },
    noCompany:          { en: '(No Company Assigned)',     ja: '（会社未設定）' },
  
    // ── Progress Chart ──────────────────────────────────────────────────────────
    totalExams:         { en: 'Total Exams',               ja: '受験回数' },
    averageScore:       { en: 'Average Score',             ja: '平均点' },
    bestScore:          { en: 'Best Score',                ja: '最高得点' },
    latestScore:        { en: 'Latest Score',              ja: '直近の得点' },
  
    // ── Settings ────────────────────────────────────────────────────────────────
    settings:           { en: '⚙️ Settings',               ja: '⚙️ 設定' },
    back:               { en: '← Back',                   ja: '← 戻る' },
    storage:            { en: 'Storage',                   ja: 'ストレージ' },
    appInfo:            { en: 'App Info',                  ja: 'アプリ情報' },
    manage:             { en: 'Manage',                    ja: '管理' },
    serverMonitor:      { en: 'Server',                    ja: 'サーバー' },
    totalBatches:       { en: 'Total Batches',             ja: '総クラス数' },
    totalStudents:      { en: 'Total Students',            ja: '総受講者数' },
    totalImages:        { en: 'Total Images',              ja: '総画像数' },
    refresh:            { en: '🔄 Refresh',                ja: '🔄 更新' },
    loading:            { en: 'Loading...',                ja: '読み込み中...' },
  
    // ── General ──────────────────────────────────────────────────────────────────
    delete:             { en: 'Delete',                    ja: '削除' },
    deleteBtnConfirm:   { en: 'Delete',                    ja: '削除する' },
    edit:               { en: '✎',                        ja: '✎' },
  
  };
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Helper: get language code for the currently logged-in role
  // ─────────────────────────────────────────────────────────────────────────────
  export function getLanguage() {
    try {
      const role = localStorage.getItem('sage_role') || 'admin';
      return ROLE_LANGUAGE_MAP[role] || 'en';
    } catch {
      return 'en';
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Main translate function
  // Usage: t('logout') → 'Logout' or 'ログアウト'
  // ─────────────────────────────────────────────────────────────────────────────
  export function t(key) {
    const lang = getLanguage();
    const entry = translations[key];
    if (!entry) {
      console.warn(`[i18n] Missing translation key: "${key}"`);
      return key;
    }
    return entry[lang] ?? entry['en'] ?? key;
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // Export full map (useful if a component needs to pass lang manually)
  // ─────────────────────────────────────────────────────────────────────────────
  export default translations;