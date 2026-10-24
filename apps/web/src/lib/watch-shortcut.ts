// An unsigned Apple Shortcut the iPhone Shortcuts app can import. WatchKit makes it show on Apple Watch.
// The first action is the access token. Import asks for it, and every request sends it as a Bearer token.

const TOKEN = 'A1B2C3D4-1111-4111-8111-111111111111';
const SERVER = 'A1B2C3D4-5555-4555-8555-555555555555';
const DICTATE_ADD = 'A1B2C3D4-2222-4222-8222-222222222222';
const ASK_INDEX = 'A1B2C3D4-4444-4444-8444-444444444444';
const DICTATE_NOTE = 'A1B2C3D4-3333-4333-8333-333333333333';
const MENU = 'TODO-MENU-1';
const OBJ = '\uFFFC';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function textValue(value: string, attachments: { at: number; uuid: string; name: string }[] = []): string {
  const map = attachments
    .map(
      (a) => `              <key>{${a.at}, 1}</key>
              <dict>
                <key>OutputName</key>
                <string>${esc(a.name)}</string>
                <key>OutputUUID</key>
                <string>${a.uuid}</string>
                <key>Type</key>
                <string>ActionOutput</string>
              </dict>`,
    )
    .join('\n');
  return `<dict>
        <key>Value</key>
        <dict>
          <key>attachmentsByRange</key>
          <dict>
${map}
          </dict>
          <key>string</key>
          <string>${esc(value)}</string>
        </dict>
        <key>WFSerializationType</key>
        <string>WFTextTokenString</string>
      </dict>`;
}

function action(id: string, uuid: string | undefined, inner: string): string {
  return `    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>${id}</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
${inner}
      </dict>${uuid ? `\n      <key>UUID</key>\n      <string>${uuid}</string>` : ''}
    </dict>`;
}

function menuCase(title: string): string {
  return action('is.workflow.actions.choosefrommenu', undefined, `        <key>GroupingIdentifier</key>
        <string>${MENU}</string>
        <key>WFControlFlowMode</key>
        <integer>2</integer>
        <key>WFMenuItemTitle</key>
        <string>${esc(title)}</string>`);
}

function request(method: 'GET' | 'POST', path: string, json?: { key: string; uuid: string; name: string }[]): string {
  const headers = `        <key>WFHTTPHeaders</key>
        <dict>
          <key>Value</key>
          <dict>
            <key>WFDictionaryFieldValueItems</key>
            <array>
              <dict>
                <key>WFItemType</key>
                <integer>0</integer>
                <key>WFKey</key>
                ${textValue('Authorization')}
                <key>WFValue</key>
                ${textValue(`Bearer ${OBJ}`, [{ at: 7, uuid: TOKEN, name: 'Token' }])}
              </dict>
            </array>
          </dict>
          <key>WFSerializationType</key>
          <string>WFDictionaryFieldValue</string>
        </dict>`;
  const body = json
    ? `
        <key>WFHTTPBodyType</key>
        <string>JSON</string>
        <key>WFJSONValues</key>
        <dict>
          <key>Value</key>
          <dict>
            <key>WFDictionaryFieldValueItems</key>
            <array>
${json
  .map(
    (f) => `              <dict>
                <key>WFItemType</key>
                <integer>0</integer>
                <key>WFKey</key>
                ${textValue(f.key)}
                <key>WFValue</key>
                ${textValue(OBJ, [{ at: 0, uuid: f.uuid, name: f.name }])}
              </dict>`,
  )
  .join('\n')}
            </array>
          </dict>
          <key>WFSerializationType</key>
          <string>WFDictionaryFieldValue</string>
        </dict>`
    : '';
  return action(
    'is.workflow.actions.downloadurl',
    undefined,
    `        <key>WFHTTPMethod</key>
        <string>${method}</string>
${headers}${body}
        <key>WFURL</key>
        ${textValue(`${OBJ}${path}`, [{ at: 0, uuid: SERVER, name: 'Server' }])}`,
  );
}

const message = action('is.workflow.actions.getvalueforkey', undefined, `        <key>WFDictionaryKey</key>
        <string>message</string>`);
const show = action('is.workflow.actions.showresult', undefined, '');

/** A shortcut named Todo: add a task, replace today's note, or read today's list. */
export function watchShortcut(origin: string): string {
  const server = origin.replace(/\/$/, '');
  const actions = [
    action(
      'is.workflow.actions.gettext',
      TOKEN,
      `        <key>CustomOutputName</key>
        <string>Token</string>
        <key>WFTextActionText</key>
        <string>PASTE_YOUR_TOKEN</string>`,
    ),
    action(
      'is.workflow.actions.gettext',
      SERVER,
      `        <key>CustomOutputName</key>
        <string>Server</string>
        <key>WFTextActionText</key>
        <string>${esc(server)}</string>`,
    ),
    action(
      'is.workflow.actions.choosefrommenu',
      undefined,
      `        <key>GroupingIdentifier</key>
        <string>${MENU}</string>
        <key>WFControlFlowMode</key>
        <integer>0</integer>
        <key>WFMenuPrompt</key>
        <string>What do you want to do?</string>
        <key>WFMenuItems</key>
        <array>
          <string>Add a task</string>
          <string>Update a note</string>
          <string>What's on today</string>
        </array>`,
    ),
    menuCase('Add a task'),
    action('is.workflow.actions.dictatetext', DICTATE_ADD, `        <key>WFDictateTextStopListening</key>
        <string>After Pause</string>`),
    request('POST', '/api/v1/capture', [{ key: 'text', uuid: DICTATE_ADD, name: 'Dictated Text' }]),
    message,
    show,
    menuCase('Update a note'),
    request('GET', '/api/v1/capture/today?format=text'),
    show,
    action(
      'is.workflow.actions.ask',
      ASK_INDEX,
      `        <key>WFAskActionPrompt</key>
        <string>Which number?</string>
        <key>WFInputType</key>
        <string>Number</string>`,
    ),
    action('is.workflow.actions.dictatetext', DICTATE_NOTE, `        <key>WFDictateTextStopListening</key>
        <string>After Pause</string>`),
    request('POST', '/api/v1/capture/note', [
      { key: 'index', uuid: ASK_INDEX, name: 'Provided Input' },
      { key: 'text', uuid: DICTATE_NOTE, name: 'Dictated Text' },
    ]),
    message,
    show,
    menuCase("What's on today"),
    request('GET', '/api/v1/capture/today?format=text'),
    show,
    action(
      'is.workflow.actions.choosefrommenu',
      undefined,
      `        <key>GroupingIdentifier</key>
        <string>${MENU}</string>
        <key>WFControlFlowMode</key>
        <integer>1</integer>`,
    ),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>WFWorkflowActions</key>
  <array>
${actions.join('\n')}
  </array>
  <key>WFWorkflowClientRelease</key>
  <string>18.0</string>
  <key>WFWorkflowClientVersion</key>
  <string>3036.0.4</string>
  <key>WFWorkflowHasOutputFallback</key>
  <false/>
  <key>WFWorkflowHasShortcutInputVariables</key>
  <false/>
  <key>WFWorkflowIcon</key>
  <dict>
    <key>WFWorkflowIconGlyphNumber</key>
    <integer>59511</integer>
    <key>WFWorkflowIconStartColor</key>
    <integer>4282601983</integer>
  </dict>
  <key>WFWorkflowImportQuestions</key>
  <array>
    <dict>
      <key>ActionIndex</key>
      <integer>0</integer>
      <key>Category</key>
      <string>Parameter</string>
      <key>DefaultValue</key>
      <string>PASTE_YOUR_TOKEN</string>
      <key>ParameterKey</key>
      <string>WFTextActionText</string>
      <key>Text</key>
      <string>Paste your access token (wos_…)</string>
    </dict>
    <dict>
      <key>ActionIndex</key>
      <integer>1</integer>
      <key>Category</key>
      <string>Parameter</string>
      <key>DefaultValue</key>
      <string>${esc(server)}</string>
      <key>ParameterKey</key>
      <string>WFTextActionText</string>
      <key>Text</key>
      <string>Server address, with no slash at the end</string>
    </dict>
  </array>
  <key>WFWorkflowInputContentItemClasses</key>
  <array>
    <string>WFStringContentItem</string>
  </array>
  <key>WFWorkflowMinimumClientVersion</key>
  <integer>1113</integer>
  <key>WFWorkflowMinimumClientVersionString</key>
  <string>1113</string>
  <key>WFWorkflowName</key>
  <string>Todo</string>
  <key>WFWorkflowNoInputBehavior</key>
  <dict>
    <key>Name</key>
    <string>WFWorkflowNoInputBehaviorContinue</string>
  </dict>
  <key>WFWorkflowOutputContentItemClasses</key>
  <array/>
  <key>WFWorkflowTypes</key>
  <array>
    <string>NCWidget</string>
    <string>WatchKit</string>
  </array>
</dict>
</plist>
`;
}

export function downloadWatchShortcut(origin: string): void {
  const blob = new Blob([watchShortcut(origin)], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Todo.shortcut';
  a.click();
  URL.revokeObjectURL(url);
}
