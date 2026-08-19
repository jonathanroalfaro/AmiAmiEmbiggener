// Style Changes
(function () {
  const style = document.createElement("style");
  style.textContent = `
    @media screen and (min-width: 768px) {
      .newly-added-items__item__image_item img {
        max-height: 250px !important;
      }

      .newly-added-items__item {
          width: 250px !important;
        }
    }
  `;
  document.head.appendChild(style);
})();

// Keyboard navigation
document.addEventListener("keydown", (event) => {
    if (!["ArrowRight", "ArrowLeft"].includes(event.key)) return;

    // Don't hijack arrow keys while the user is typing in a form field
    const target = event.target;
    if (target instanceof Element &&
        (target.matches("input, textarea, select") || target.isContentEditable)) {
      return;
    }

    const url = new URL(window.location.href);
    const params = url.searchParams;
    const currentPage = parseInt(params.get("pagecnt")) || 1;

    if (event.key === "ArrowRight") {
      params.set("pagecnt", currentPage + 1);
    } else if (event.key === "ArrowLeft" && currentPage > 1) {
      params.set("pagecnt", currentPage - 1);
    }

    window.location.href = url.toString();
  });

// JAN code links to MyFigureCollection
function modifyJanCode() {
  const dtElements = document.querySelectorAll('dt.item-about__data-title');
  for (let dt of dtElements) {
    if (dt.textContent.trim() === "JAN code") {
      const dd = dt.nextElementSibling;
      if (dd && dd.classList.contains('item-about__data-text')) {
        // Already converted to a link
        if (dd.querySelector('a')) break;

        const janCode = dd.textContent.trim();
        if (/^\d+$/.test(janCode)) {
          const a = document.createElement("a");
          a.href = `https://myfigurecollection.net/?keywords=${janCode}&_tb=item`;
          a.setAttribute("class", "");

          const span = document.createElement("span");
          span.className = "item-about__data-gray";
          span.textContent = janCode;

          a.appendChild(span);
          dd.textContent = "";
          dd.appendChild(a);
        }
      }
      break;
    }
  }
}

// Embed images directly into the page
function embedImages() {
  const pager = document.querySelector("div.item-detail__pager");
  const itemAbout = document.querySelector("section.item-about");
  if (!pager || !itemAbout) return;

  // Already embedded on this page's DOM
  if (itemAbout.querySelector(".embiggener-image-container")) return;

  // Gather image URLs from each <a> element.
  const imageLinks = pager.querySelectorAll("a");
  const imageUrls = [];

  imageLinks.forEach(link => {
    // Try to read the URL from the custom 'src' attribute.
    let url = link.getAttribute("src");
    if (!url) {
      // Fallback: try getting it from the inner <img> tag.
      const img = link.querySelector("img");
      if (img) {
        url = img.src;
      }
    }
    if (url) {
      imageUrls.push(url);
    }
  });

  // If there is only one image, do nothing.
  if (imageUrls.length <= 1) {
    return;
  }

  // Omit the first image from the list.
  const imagesToDisplay = imageUrls.slice(1);

  // Create a container for the additional images.
  const imageContainer = document.createElement("div");
  imageContainer.className = "embiggener-image-container";
  imageContainer.style.marginTop = "20px"; // Add spacing at the top

  // Create an image element for each URL.
  imagesToDisplay.forEach(url => {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "Additional image";
    img.style.maxWidth = "100%";  // Responsive images
    img.style.display = "block";
    img.style.marginBottom = "10px"; // Spacing between images
    imageContainer.appendChild(img);
  });

  // Append the container to the end of the 'item-about' section.
  itemAbout.appendChild(imageContainer);
}

// Add "Search on Buyfriend.moe" text to order items
function addBuyfriendText() {
  const items = document.querySelectorAll('.order-img-list__item');

  items.forEach(item => {
    if (item.nextElementSibling && item.nextElementSibling.classList.contains('buyfriend-text')) return;

    const productLink = item.querySelector('.order-img-list__item_name a');
    if (!productLink) return;

    const buyfriendUrl = 'https://buyfriend.moe/search?search=' + encodeURIComponent(productLink.href);

    const a = document.createElement('a');
    a.className = 'buyfriend-text';
    a.href = buyfriendUrl;
    a.target = '_blank';
    a.textContent = 'Search on Buyfriend.moe';
    item.parentElement.insertBefore(a, item.nextSibling);
  });
}

// Convert order list items to real hyperlinks
function convertOrderLinks() {
  const orderItems = document.querySelectorAll('div.order-list__item');
  if (orderItems.length === 0) return;

  const pathMatch = window.location.pathname.match(/^\/(\w+)\/(\w+)/);
  if (!pathMatch) return;

  const lang = pathMatch[1];
  const section = pathMatch[2];

  orderItems.forEach(item => {
    if (item.parentElement && item.parentElement.tagName === 'A') return;

    const label = item.querySelector('.order-list__item_label');
    if (!label) return;

    const match = label.textContent.match(/(\d+)\s*$/);
    if (!match) return;

    const orderNumber = match[1];
    const url = `/${lang}/${section}/2?d_no=${orderNumber}`;

    const a = document.createElement('a');
    a.href = url;
    a.style.textDecoration = 'none';
    a.style.color = 'inherit';
    a.style.display = 'block';

    item.parentElement.insertBefore(a, item);
    a.appendChild(item);
  });
}

// Refresh page if System Error Occured happens
let reloadScheduled = false;
function checkForSystemError() {
  if (reloadScheduled) return;
  if (document.body.innerText.includes("Please try again a little later.")) {
    reloadScheduled = true;
    // Wait a bit before reloading so the server isn't hammered
    setTimeout(() => location.reload(), 250);
  }
}

function runAllFeatures() {
  modifyJanCode();
  embedImages();
  addBuyfriendText();
  convertOrderLinks();
  checkForSystemError();
}

// AmiAmi is a SPA: in-site navigation swaps DOM content without a page load,
// so re-run the (idempotent) features whenever the DOM settles after changes.
(function () {
  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runAllFeatures, 150);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  runAllFeatures();
})();
