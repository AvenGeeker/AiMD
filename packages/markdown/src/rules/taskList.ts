import type { MarkdownIt, StateCore, Token } from 'markdown-it';

const TODO_RE = /^\[( |x|X)\]\s+/;

function attrAdd(token: Token, name: string, value: string): void {
  const existing = token.attrGet(name);
  token.attrSet(name, existing ? `${existing} ${value}` : value);
}

/**
 * GitHub-flavoured task lists (`- [ ] todo`, `- [x] done`).
 *
 * markdown-it has no built-in support. We rewrite the first inline token of each list item
 * into a disabled checkbox. The checkbox is emitted as an `html_inline` token, which
 * markdown-it renders verbatim regardless of the `html: false` option — safe here because
 * the string is fully controlled by us and never contains user input.
 */
export function taskListPlugin(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'amd_task_list', (state: StateCore) => {
    const tokens = state.tokens;
    // Stack of indices of currently-open list tokens, so we can tag the enclosing list.
    const openLists: number[] = [];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (!token) continue;

      if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
        openLists.push(i);
        continue;
      }
      if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') {
        openLists.pop();
        continue;
      }
      if (token.type !== 'inline' || !token.children || token.children.length === 0) continue;

      const paragraph = tokens[i - 1];
      const listItem = tokens[i - 2];
      if (paragraph?.type !== 'paragraph_open' || listItem?.type !== 'list_item_open') continue;

      const match = TODO_RE.exec(token.content);
      if (!match) continue;

      const checked = match[1] !== ' ';
      const checkbox = new state.Token('html_inline', '', 0);
      checkbox.content =
        `<input class="task-list-item-checkbox" type="checkbox" disabled${checked ? ' checked' : ''}>`;
      token.children.unshift(checkbox);

      const label = token.children[1];
      if (label) label.content = label.content.slice(match[0].length);
      token.content = token.content.slice(match[0].length);

      attrAdd(listItem, 'class', 'task-list-item');
      const enclosing = openLists[openLists.length - 1];
      if (enclosing !== undefined) {
        const listToken = tokens[enclosing];
        if (listToken) attrAdd(listToken, 'class', 'contains-task-list');
      }
    }
  });
}
