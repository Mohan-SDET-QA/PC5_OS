// Store data from public Steam and Epic endpoints. Purchases and downloads
// always happen inside the official clients (opened via steam:// / epic URIs).
const cache = new Map();
const TTL = 10 * 60 * 1000;

async function getJson(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const res = await fetch(url, { headers: { 'Accept-Language': 'en-US' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const data = await res.json();
  cache.set(url, { at: Date.now(), data });
  return data;
}

function money(cents, currency) {
  if (cents == null) return '';
  if (cents === 0) return 'Free';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(cents / 100);
  } catch {
    return (cents / 100).toFixed(2);
  }
}

const steamHeader = (id) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`;

function steamItem(i) {
  return {
    store: 'steam',
    id: String(i.id),
    name: i.name,
    image: steamHeader(i.id),
    price: money(i.final_price, i.currency),
    originalPrice: i.discounted ? money(i.original_price, i.currency) : '',
    discount: i.discount_percent || 0,
    storeUri: `steam://store/${i.id}`,
    installUri: `steam://install/${i.id}`,
  };
}

async function steamFeatured() {
  const data = await getJson('https://store.steampowered.com/api/featuredcategories?cc=us&l=english');
  const sections = [
    ['top_sellers', 'Top Sellers'],
    ['specials', 'Special Offers'],
    ['new_releases', 'New Releases'],
  ];
  return sections
    .filter(([key]) => data[key] && Array.isArray(data[key].items))
    .map(([key, title]) => {
      const seen = new Set();
      const items = data[key].items
        .filter((i) => i.type === 0 && !seen.has(i.id) && seen.add(i.id))
        .map(steamItem);
      return { title, items };
    })
    .filter((s) => s.items.length);
}

async function steamSearch(term) {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=US`;
  const data = await getJson(url);
  return (data.items || []).map((i) => ({
    store: 'steam',
    id: String(i.id),
    name: i.name,
    image: steamHeader(i.id),
    price: i.price ? money(i.price.final, i.price.currency) : 'Free',
    storeUri: `steam://store/${i.id}`,
    installUri: `steam://install/${i.id}`,
  }));
}

async function epicFree() {
  const url = 'https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US';
  const data = await getJson(url);
  const elements = data?.data?.Catalog?.searchStore?.elements || [];
  return elements
    .filter((e) => {
      const offers = e.promotions?.promotionalOffers?.[0]?.promotionalOffers || [];
      return offers.length && e.price?.totalPrice?.discountPrice === 0;
    })
    .map((e) => {
      const img = (e.keyImages || []).find((k) => k.type === 'OfferImageWide') || (e.keyImages || [])[0];
      const slug = e.productSlug || e.catalogNs?.mappings?.[0]?.pageSlug || e.urlSlug;
      return {
        store: 'epic',
        id: e.id,
        name: e.title,
        image: img ? img.url : '',
        price: 'Free this week',
        storeUri: `com.epicgames.launcher://store/p/${slug}`,
      };
    });
}

// Free-to-play games on Steam (install straight away with steam://install).
async function steamFreeToPlay() {
  const url = 'https://store.steampowered.com/search/results/?query=&start=0&count=30&maxprice=free&category1=998&json=1&cc=us&l=english';
  const data = await getJson(url);
  return (data.items || [])
    .map((i) => {
      const m = /\/apps\/(\d+)\//.exec(i.logo || '');
      if (!m) return null;
      return {
        store: 'steam', id: m[1], name: i.name, image: steamHeader(m[1]), price: 'Free to Play',
        storeUri: `steam://store/${m[1]}`, installUri: `steam://install/${m[1]}`, free: true,
      };
    })
    .filter(Boolean);
}

// Limited-time free games from every store (Steam, Epic, GOG, itch.io, ...),
// aggregated by GamerPower. Claiming happens on the store's own page.
async function giveaways() {
  const data = await getJson('https://www.gamerpower.com/api/giveaways?platform=pc&type=game&sort-by=popularity');
  return (Array.isArray(data) ? data : []).slice(0, 30).map((g) => ({
    store: 'giveaway',
    id: String(g.id),
    name: g.title.replace(/\s*\((Steam|Epic Games|GOG|Itch\.io)\)\s*Giveaway$/i, '').replace(/\s+Giveaway$/i, ''),
    image: g.image || g.thumbnail,
    price: g.worth && g.worth !== 'N/A' ? `Free · was ${g.worth}` : 'Free',
    platforms: g.platforms,
    description: g.description,
    instructions: g.instructions,
    ends: g.end_date && g.end_date !== 'N/A' ? g.end_date : '',
    url: g.open_giveaway_url || g.gamerpower_url,
  }));
}

module.exports = { steamFeatured, steamSearch, epicFree, steamFreeToPlay, giveaways };
