export const redirect = (url, delayInSeconds = 0) => {
  const tag = document.createElement("meta");
  tag.setAttribute("http-equiv", "Refresh");
  tag.setAttribute("content", `${delayInSeconds}; url=${url}`);
  document.head.appendChild(tag);
};

export const setMetaTag = (name, content) => {
  let metaTag = document.getElementsByName(name)[0];
  if (metaTag == null) {
    const headerNodes = [...document.head.childNodes.values()];
    const lastMetaTagInHead = headerNodes
      .filter(n => n.tagName === "META")
      .slice(-1)[0];
    metaTag = document.createElement("meta");
    if (lastMetaTagInHead != null) {
      lastMetaTagInHead.insertAdjacentElement("afterend", metaTag);
    } else {
      document.head.appendChild(metaTag);
    }
  }
  metaTag.setAttribute("name", name);
  metaTag.setAttribute("content", content);
};

export const setCanonicalTag = url => {
  let metaTag = document.querySelector("[rel=canonical]");
  if (metaTag == null) {
    const headerNodes = [...document.head.childNodes.values()];
    const lastMetaTagInHead = headerNodes
      .filter(n => n.tagName === "META")
      .slice(-1)[0];
    metaTag = document.createElement("meta");
    if (lastMetaTagInHead != null) {
      lastMetaTagInHead.insertAdjacentElement("afterend", metaTag);
    } else {
      document.head.appendChild(metaTag);
    }
  }
  metaTag.setAttribute("rel", "canonical");
  metaTag.setAttribute("href", url);
};

export default {
  redirect,
  setMetaTag,
  setCanonicalTag
};