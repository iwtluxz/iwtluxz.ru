(() => {
  const tree = document.querySelector(".sidebar-xmas-tree");
  if (!tree) return;
  const fallback = tree.src;
  tree.addEventListener("error", () => {
    if (!tree.dataset.fallbackUsed) {
      tree.dataset.fallbackUsed = "1";
      tree.src = fallback;
    }
  }, { once: true });
  const files = [
    "img/xmas-tree-part0.bin?v=20261109",
    "img/xmas-tree-part1.txt?v=20261109",
    "img/xmas-tree-part2.txt?v=20261109",
    "img/xmas-tree-part3.txt?v=20261109"
  ];
  Promise.all(files.map(async (path, index) => {
    const response = await fetch(path, { cache: "force-cache" });
    if (!response.ok) throw new Error("Could not load Christmas tree image part " + index);
    return index === 0 ? response.arrayBuffer() : response.text();
  })).then(([firstPart, ...base64Parts]) => {
    const first = new Uint8Array(firstPart);
    const tailString = atob(base64Parts.join(""));
    const bytes = new Uint8Array(first.length + tailString.length);
    bytes.set(first, 0);
    for (let i = 0; i < tailString.length; i++) bytes[first.length + i] = tailString.charCodeAt(i);
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: "image/avif" }));
    tree.src = objectUrl;
  }).catch(error => console.warn("Christmas tree image could not be loaded; using fallback.", error));
})();
