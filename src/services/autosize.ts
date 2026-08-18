// The one way a text box is sized in this app: it opens at a single line and grows as wrapping adds lines.
// Manual resize handles are banned outright — every textarea gets `resize: none` in CSS and calls this from its
// ref (fits any prefilled content on mount) and its onChange (follows typing).
export const autosize = (element: HTMLTextAreaElement | null) => {
  if (!element) return
  element.style.height = 'auto'
  element.style.height = `${element.scrollHeight}px`
}
