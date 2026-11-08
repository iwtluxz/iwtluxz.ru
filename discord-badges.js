(() => {
  'use strict';
  // Original Discord artwork; manual choices decorate a page and do not verify account awards.
  const groups = Object.freeze([
  {
    "id": "nitro",
    "label": "Nitro"
  },
  {
    "id": "boost",
    "label": "Server Boost"
  },
  {
    "id": "streaming",
    "label": "Стриминг"
  },
  {
    "id": "account-age",
    "label": "Возраст аккаунта"
  },
  {
    "id": "game-time",
    "label": "Время в играх"
  },
  {
    "id": "game-variety",
    "label": "Разные игры"
  },
  {
    "id": "gifting",
    "label": "Подарки"
  },
  {
    "id": "general",
    "label": "Значки Discord"
  },
  {
    "id": "legacy",
    "label": "Архивные значки"
  },
  {
    "id": "apps",
    "label": "Приложения"
  }
].map(Object.freeze));
  const items = Object.freeze([
  {
    "id": "staff",
    "label": "Discord Staff",
    "image": "/img/discord-badges/staff.png",
    "group": "general",
    "keywords": "дискорд discord",
    "automatic": true
  },
  {
    "id": "partner",
    "label": "Partnered Server Owner",
    "image": "/img/discord-badges/partner.png",
    "group": "general",
    "keywords": "дискорд discord",
    "automatic": true
  },
  {
    "id": "hypesquad-events",
    "label": "HypeSquad Events",
    "image": "/img/discord-badges/hypesquad-events.svg",
    "group": "legacy",
    "keywords": "дискорд discord",
    "automatic": true
  },
  {
    "id": "bug-hunter-level-1",
    "label": "Bug Hunter · Level 1",
    "image": "/img/discord-badges/bug-hunter-level-1.png",
    "group": "general",
    "keywords": "дискорд discord",
    "automatic": true
  },
  {
    "id": "bug-hunter-level-2",
    "label": "Bug Hunter · Level 2",
    "image": "/img/discord-badges/bug-hunter-level-2.png",
    "group": "general",
    "keywords": "дискорд discord",
    "automatic": true
  },
  {
    "id": "house-bravery",
    "label": "HypeSquad · Bravery",
    "image": "/img/discord-badges/house-bravery.png",
    "group": "legacy",
    "keywords": "дискорд discord",
    "automatic": true
  },
  {
    "id": "house-brilliance",
    "label": "HypeSquad · Brilliance",
    "image": "/img/discord-badges/house-brilliance.png",
    "group": "legacy",
    "keywords": "дискорд discord",
    "automatic": true
  },
  {
    "id": "house-balance",
    "label": "HypeSquad · Balance",
    "image": "/img/discord-badges/house-balance.png",
    "group": "legacy",
    "keywords": "дискорд discord",
    "automatic": true
  },
  {
    "id": "early-supporter",
    "label": "Early Supporter",
    "image": "/img/discord-badges/early-supporter.png",
    "group": "legacy",
    "keywords": "дискорд discord",
    "automatic": true
  },
  {
    "id": "early-verified-developer",
    "label": "Early Verified Bot Developer",
    "image": "/img/discord-badges/early-verified-developer.png",
    "group": "legacy",
    "keywords": "дискорд discord",
    "automatic": true
  },
  {
    "id": "moderator-alumni",
    "label": "Moderator Programs Alumni",
    "image": "/img/discord-badges/moderator-alumni.svg",
    "group": "legacy",
    "keywords": "дискорд discord",
    "automatic": true
  },
  {
    "id": "server-booster",
    "label": "Server Booster",
    "image": "/img/discord-badges/server-booster.svg",
    "group": "boost",
    "keywords": "дискорд discord",
    "automatic": true
  },
  {
    "id": "nitro",
    "label": "Nitro · прежний значок",
    "image": "/img/discord-badges/nitro.png",
    "group": "legacy",
    "keywords": "дискорд discord нитро старый",
    "automatic": false
  },
  {
    "id": "active-developer",
    "label": "Active Developer",
    "image": "/img/discord-badges/active-developer.svg",
    "group": "legacy",
    "keywords": "дискорд discord",
    "automatic": false
  },
  {
    "id": "nitro-current",
    "label": "Nitro · новый значок",
    "image": "/img/discord-badges/nitro-current.svg",
    "group": "nitro",
    "keywords": "нитро новый подписка",
    "automatic": false
  },
  {
    "id": "nitro-basic",
    "label": "Nitro Basic / Classic",
    "image": "/img/discord-badges/nitro-basic.svg",
    "group": "nitro",
    "keywords": "нитро базовый классик подписка",
    "automatic": false
  },
  {
    "id": "nitro-bronze",
    "label": "Nitro · Bronze · 1 мес.",
    "image": "/img/discord-badges/nitro-bronze.png",
    "group": "nitro",
    "keywords": "нитро подписка уровень 1",
    "automatic": false
  },
  {
    "id": "nitro-silver",
    "label": "Nitro · Silver · 3 мес.",
    "image": "/img/discord-badges/nitro-silver.png",
    "group": "nitro",
    "keywords": "нитро подписка уровень 2",
    "automatic": false
  },
  {
    "id": "nitro-gold",
    "label": "Nitro · Gold · 6 мес.",
    "image": "/img/discord-badges/nitro-gold.png",
    "group": "nitro",
    "keywords": "нитро подписка уровень 3",
    "automatic": false
  },
  {
    "id": "nitro-platinum",
    "label": "Nitro · Platinum · 12 мес.",
    "image": "/img/discord-badges/nitro-platinum.png",
    "group": "nitro",
    "keywords": "нитро подписка уровень 4",
    "automatic": false
  },
  {
    "id": "nitro-diamond",
    "label": "Nitro · Diamond · 24 мес.",
    "image": "/img/discord-badges/nitro-diamond.png",
    "group": "nitro",
    "keywords": "нитро подписка уровень 5",
    "automatic": false
  },
  {
    "id": "nitro-emerald",
    "label": "Nitro · Emerald · 36 мес.",
    "image": "/img/discord-badges/nitro-emerald.png",
    "group": "nitro",
    "keywords": "нитро подписка уровень 6",
    "automatic": false
  },
  {
    "id": "nitro-ruby",
    "label": "Nitro · Ruby · 60 мес.",
    "image": "/img/discord-badges/nitro-ruby.png",
    "group": "nitro",
    "keywords": "нитро подписка уровень 7",
    "automatic": false
  },
  {
    "id": "nitro-opal",
    "label": "Nitro · Opal · 72 мес.",
    "image": "/img/discord-badges/nitro-opal.png",
    "group": "nitro",
    "keywords": "нитро подписка уровень 8",
    "automatic": false
  },
  {
    "id": "nitro-legacy-bronze",
    "label": "Nitro · архив · Bronze",
    "image": "/img/discord-badges/nitro-legacy-bronze.svg",
    "group": "legacy",
    "keywords": "нитро старый подписка",
    "automatic": false
  },
  {
    "id": "nitro-legacy-silver",
    "label": "Nitro · архив · Silver",
    "image": "/img/discord-badges/nitro-legacy-silver.svg",
    "group": "legacy",
    "keywords": "нитро старый подписка",
    "automatic": false
  },
  {
    "id": "nitro-legacy-gold",
    "label": "Nitro · архив · Gold",
    "image": "/img/discord-badges/nitro-legacy-gold.svg",
    "group": "legacy",
    "keywords": "нитро старый подписка",
    "automatic": false
  },
  {
    "id": "nitro-legacy-platinum",
    "label": "Nitro · архив · Platinum",
    "image": "/img/discord-badges/nitro-legacy-platinum.svg",
    "group": "legacy",
    "keywords": "нитро старый подписка",
    "automatic": false
  },
  {
    "id": "nitro-legacy-diamond",
    "label": "Nitro · архив · Diamond",
    "image": "/img/discord-badges/nitro-legacy-diamond.svg",
    "group": "legacy",
    "keywords": "нитро старый подписка",
    "automatic": false
  },
  {
    "id": "nitro-legacy-emerald",
    "label": "Nitro · архив · Emerald",
    "image": "/img/discord-badges/nitro-legacy-emerald.svg",
    "group": "legacy",
    "keywords": "нитро старый подписка",
    "automatic": false
  },
  {
    "id": "nitro-legacy-ruby",
    "label": "Nitro · архив · Ruby",
    "image": "/img/discord-badges/nitro-legacy-ruby.svg",
    "group": "legacy",
    "keywords": "нитро старый подписка",
    "automatic": false
  },
  {
    "id": "nitro-legacy-fire",
    "label": "Nitro · архив · Fire",
    "image": "/img/discord-badges/nitro-legacy-fire.svg",
    "group": "legacy",
    "keywords": "нитро старый подписка",
    "automatic": false
  },
  {
    "id": "server-booster-1",
    "label": "Server Booster · 1 мес.",
    "image": "/img/discord-badges/server-booster-1.svg",
    "group": "boost",
    "keywords": "буст бустер уровень 1",
    "automatic": false
  },
  {
    "id": "server-booster-2",
    "label": "Server Booster · 2 мес.",
    "image": "/img/discord-badges/server-booster-2.svg",
    "group": "boost",
    "keywords": "буст бустер уровень 2",
    "automatic": false
  },
  {
    "id": "server-booster-3",
    "label": "Server Booster · 3 мес.",
    "image": "/img/discord-badges/server-booster-3.svg",
    "group": "boost",
    "keywords": "буст бустер уровень 3",
    "automatic": false
  },
  {
    "id": "server-booster-6",
    "label": "Server Booster · 6 мес.",
    "image": "/img/discord-badges/server-booster-6.svg",
    "group": "boost",
    "keywords": "буст бустер уровень 4",
    "automatic": false
  },
  {
    "id": "server-booster-9",
    "label": "Server Booster · 9 мес.",
    "image": "/img/discord-badges/server-booster-9.svg",
    "group": "boost",
    "keywords": "буст бустер уровень 5",
    "automatic": false
  },
  {
    "id": "server-booster-12",
    "label": "Server Booster · 12 мес.",
    "image": "/img/discord-badges/server-booster-12.svg",
    "group": "boost",
    "keywords": "буст бустер уровень 6",
    "automatic": false
  },
  {
    "id": "server-booster-15",
    "label": "Server Booster · 15 мес.",
    "image": "/img/discord-badges/server-booster-15.svg",
    "group": "boost",
    "keywords": "буст бустер уровень 7",
    "automatic": false
  },
  {
    "id": "server-booster-18",
    "label": "Server Booster · 18 мес.",
    "image": "/img/discord-badges/server-booster-18.svg",
    "group": "boost",
    "keywords": "буст бустер уровень 8",
    "automatic": false
  },
  {
    "id": "server-booster-24",
    "label": "Server Booster · 24 мес.",
    "image": "/img/discord-badges/server-booster-24.svg",
    "group": "boost",
    "keywords": "буст бустер уровень 9",
    "automatic": false
  },
  {
    "id": "streaming-newcomer",
    "label": "Streaming · Newcomer",
    "image": "/img/discord-badges/streaming-newcomer.svg",
    "group": "streaming",
    "keywords": "стриминг трансляция уровень 1",
    "automatic": false
  },
  {
    "id": "streaming-fledgling",
    "label": "Streaming · Fledgling",
    "image": "/img/discord-badges/streaming-fledgling.svg",
    "group": "streaming",
    "keywords": "стриминг трансляция уровень 2",
    "automatic": false
  },
  {
    "id": "streaming-breakout",
    "label": "Streaming · Breakout",
    "image": "/img/discord-badges/streaming-breakout.svg",
    "group": "streaming",
    "keywords": "стриминг трансляция уровень 3",
    "automatic": false
  },
  {
    "id": "streaming-standout",
    "label": "Streaming · Standout",
    "image": "/img/discord-badges/streaming-standout.svg",
    "group": "streaming",
    "keywords": "стриминг трансляция уровень 4",
    "automatic": false
  },
  {
    "id": "streaming-trendsetter",
    "label": "Streaming · Trendsetter",
    "image": "/img/discord-badges/streaming-trendsetter.svg",
    "group": "streaming",
    "keywords": "стриминг трансляция уровень 5",
    "automatic": false
  },
  {
    "id": "streaming-headliner",
    "label": "Streaming · Headliner",
    "image": "/img/discord-badges/streaming-headliner.svg",
    "group": "streaming",
    "keywords": "стриминг трансляция уровень 6",
    "automatic": false
  },
  {
    "id": "streaming-star",
    "label": "Streaming · Star",
    "image": "/img/discord-badges/streaming-star.svg",
    "group": "streaming",
    "keywords": "стриминг трансляция уровень 7",
    "automatic": false
  },
  {
    "id": "streaming-sensation",
    "label": "Streaming · Sensation",
    "image": "/img/discord-badges/streaming-sensation.svg",
    "group": "streaming",
    "keywords": "стриминг трансляция уровень 8",
    "automatic": false
  },
  {
    "id": "streaming-visionary",
    "label": "Streaming · Visionary",
    "image": "/img/discord-badges/streaming-visionary.svg",
    "group": "streaming",
    "keywords": "стриминг трансляция уровень 9",
    "automatic": false
  },
  {
    "id": "streaming-phenomenon",
    "label": "Streaming · Phenomenon",
    "image": "/img/discord-badges/streaming-phenomenon.svg",
    "group": "streaming",
    "keywords": "стриминг трансляция уровень 10",
    "automatic": false
  },
  {
    "id": "account-age-seed",
    "label": "Account Age · 1 год",
    "image": "/img/discord-badges/account-age-seed.svg",
    "group": "account-age",
    "keywords": "возраст аккаунта стаж seed",
    "automatic": false
  },
  {
    "id": "account-age-sprout",
    "label": "Account Age · 2 года",
    "image": "/img/discord-badges/account-age-sprout.svg",
    "group": "account-age",
    "keywords": "возраст аккаунта стаж sprout",
    "automatic": false
  },
  {
    "id": "account-age-bud",
    "label": "Account Age · 3 года",
    "image": "/img/discord-badges/account-age-bud.svg",
    "group": "account-age",
    "keywords": "возраст аккаунта стаж bud",
    "automatic": false
  },
  {
    "id": "account-age-sapling",
    "label": "Account Age · 4 года",
    "image": "/img/discord-badges/account-age-sapling.svg",
    "group": "account-age",
    "keywords": "возраст аккаунта стаж sapling",
    "automatic": false
  },
  {
    "id": "account-age-blossom",
    "label": "Account Age · 5 лет",
    "image": "/img/discord-badges/account-age-blossom.svg",
    "group": "account-age",
    "keywords": "возраст аккаунта стаж blossom",
    "automatic": false
  },
  {
    "id": "account-age-redwood",
    "label": "Account Age · 6 лет",
    "image": "/img/discord-badges/account-age-redwood.svg",
    "group": "account-age",
    "keywords": "возраст аккаунта стаж redwood",
    "automatic": false
  },
  {
    "id": "account-age-sequoia",
    "label": "Account Age · 7 лет",
    "image": "/img/discord-badges/account-age-sequoia.svg",
    "group": "account-age",
    "keywords": "возраст аккаунта стаж sequoia",
    "automatic": false
  },
  {
    "id": "account-age-bristlecone",
    "label": "Account Age · 8 лет",
    "image": "/img/discord-badges/account-age-bristlecone.svg",
    "group": "account-age",
    "keywords": "возраст аккаунта стаж bristlecone",
    "automatic": false
  },
  {
    "id": "account-age-stromatolite",
    "label": "Account Age · 9 лет",
    "image": "/img/discord-badges/account-age-stromatolite.svg",
    "group": "account-age",
    "keywords": "возраст аккаунта стаж stromatolite",
    "automatic": false
  },
  {
    "id": "account-age-primordial",
    "label": "Account Age · 10 лет",
    "image": "/img/discord-badges/account-age-primordial.svg",
    "group": "account-age",
    "keywords": "возраст аккаунта стаж primordial",
    "automatic": false
  },
  {
    "id": "game-time-casual",
    "label": "Game Time · Casual",
    "image": "/img/discord-badges/game-time-casual.svg",
    "group": "game-time",
    "keywords": "игры время в играх уровень 1",
    "automatic": false
  },
  {
    "id": "game-time-recreational",
    "label": "Game Time · Recreational",
    "image": "/img/discord-badges/game-time-recreational.svg",
    "group": "game-time",
    "keywords": "игры время в играх уровень 2",
    "automatic": false
  },
  {
    "id": "game-time-dedicated",
    "label": "Game Time · Dedicated",
    "image": "/img/discord-badges/game-time-dedicated.svg",
    "group": "game-time",
    "keywords": "игры время в играх уровень 3",
    "automatic": false
  },
  {
    "id": "game-time-committed",
    "label": "Game Time · Committed",
    "image": "/img/discord-badges/game-time-committed.svg",
    "group": "game-time",
    "keywords": "игры время в играх уровень 4",
    "automatic": false
  },
  {
    "id": "game-time-serious",
    "label": "Game Time · Serious",
    "image": "/img/discord-badges/game-time-serious.svg",
    "group": "game-time",
    "keywords": "игры время в играх уровень 5",
    "automatic": false
  },
  {
    "id": "game-time-devoted",
    "label": "Game Time · Devoted",
    "image": "/img/discord-badges/game-time-devoted.svg",
    "group": "game-time",
    "keywords": "игры время в играх уровень 6",
    "automatic": false
  },
  {
    "id": "game-time-seasoned",
    "label": "Game Time · Seasoned",
    "image": "/img/discord-badges/game-time-seasoned.svg",
    "group": "game-time",
    "keywords": "игры время в играх уровень 7",
    "automatic": false
  },
  {
    "id": "game-time-ironclad",
    "label": "Game Time · Ironclad",
    "image": "/img/discord-badges/game-time-ironclad.svg",
    "group": "game-time",
    "keywords": "игры время в играх уровень 8",
    "automatic": false
  },
  {
    "id": "game-time-unshakeable",
    "label": "Game Time · Unshakeable",
    "image": "/img/discord-badges/game-time-unshakeable.svg",
    "group": "game-time",
    "keywords": "игры время в играх уровень 9",
    "automatic": false
  },
  {
    "id": "game-time-eternal",
    "label": "Game Time · Eternal",
    "image": "/img/discord-badges/game-time-eternal.svg",
    "group": "game-time",
    "keywords": "игры время в играх уровень 10",
    "automatic": false
  },
  {
    "id": "game-variety-sampler",
    "label": "Game Variety · Sampler",
    "image": "/img/discord-badges/game-variety-sampler.svg",
    "group": "game-variety",
    "keywords": "разные игры разнообразие уровень 1",
    "automatic": false
  },
  {
    "id": "game-variety-dabbler",
    "label": "Game Variety · Dabbler",
    "image": "/img/discord-badges/game-variety-dabbler.svg",
    "group": "game-variety",
    "keywords": "разные игры разнообразие уровень 2",
    "automatic": false
  },
  {
    "id": "game-variety-enthusiast",
    "label": "Game Variety · Enthusiast",
    "image": "/img/discord-badges/game-variety-enthusiast.svg",
    "group": "game-variety",
    "keywords": "разные игры разнообразие уровень 3",
    "automatic": false
  },
  {
    "id": "game-variety-ranger",
    "label": "Game Variety · Ranger",
    "image": "/img/discord-badges/game-variety-ranger.svg",
    "group": "game-variety",
    "keywords": "разные игры разнообразие уровень 4",
    "automatic": false
  },
  {
    "id": "game-variety-explorer",
    "label": "Game Variety · Explorer",
    "image": "/img/discord-badges/game-variety-explorer.svg",
    "group": "game-variety",
    "keywords": "разные игры разнообразие уровень 5",
    "automatic": false
  },
  {
    "id": "game-variety-adventurer",
    "label": "Game Variety · Adventurer",
    "image": "/img/discord-badges/game-variety-adventurer.svg",
    "group": "game-variety",
    "keywords": "разные игры разнообразие уровень 6",
    "automatic": false
  },
  {
    "id": "game-variety-voyager",
    "label": "Game Variety · Voyager",
    "image": "/img/discord-badges/game-variety-voyager.svg",
    "group": "game-variety",
    "keywords": "разные игры разнообразие уровень 7",
    "automatic": false
  },
  {
    "id": "game-variety-maverick",
    "label": "Game Variety · Maverick",
    "image": "/img/discord-badges/game-variety-maverick.svg",
    "group": "game-variety",
    "keywords": "разные игры разнообразие уровень 8",
    "automatic": false
  },
  {
    "id": "game-variety-polymath",
    "label": "Game Variety · Polymath",
    "image": "/img/discord-badges/game-variety-polymath.svg",
    "group": "game-variety",
    "keywords": "разные игры разнообразие уровень 9",
    "automatic": false
  },
  {
    "id": "game-variety-universalist",
    "label": "Game Variety · Universalist",
    "image": "/img/discord-badges/game-variety-universalist.svg",
    "group": "game-variety",
    "keywords": "разные игры разнообразие уровень 10",
    "automatic": false
  },
  {
    "id": "gifting-patron",
    "label": "Gifting · Patron",
    "image": "/img/discord-badges/gifting-patron.png",
    "group": "gifting",
    "keywords": "подарки даритель уровень 1",
    "automatic": false
  },
  {
    "id": "gifting-champion",
    "label": "Gifting · Champion",
    "image": "/img/discord-badges/gifting-champion.png",
    "group": "gifting",
    "keywords": "подарки даритель уровень 2",
    "automatic": false
  },
  {
    "id": "gifting-luminary",
    "label": "Gifting · Luminary",
    "image": "/img/discord-badges/gifting-luminary.png",
    "group": "gifting",
    "keywords": "подарки даритель уровень 3",
    "automatic": false
  },
  {
    "id": "gifting-icon",
    "label": "Gifting · Icon",
    "image": "/img/discord-badges/gifting-icon.png",
    "group": "gifting",
    "keywords": "подарки даритель уровень 4",
    "automatic": false
  },
  {
    "id": "gifting-hero",
    "label": "Gifting · Hero",
    "image": "/img/discord-badges/gifting-hero.png",
    "group": "gifting",
    "keywords": "подарки даритель уровень 5",
    "automatic": false
  },
  {
    "id": "gifting-legend",
    "label": "Gifting · Legend",
    "image": "/img/discord-badges/gifting-legend.png",
    "group": "gifting",
    "keywords": "подарки даритель уровень 6",
    "automatic": false
  },
  {
    "id": "quest",
    "label": "Completed a Quest",
    "image": "/img/discord-badges/quest.png",
    "group": "general",
    "keywords": "дискорд значки архив квест задания",
    "automatic": false
  },
  {
    "id": "orbs",
    "label": "Orbs Apprentice",
    "image": "/img/discord-badges/orbs.svg",
    "group": "general",
    "keywords": "дискорд значки архив орбы орб",
    "automatic": false
  },
  {
    "id": "legacy-username",
    "label": "Legacy Username",
    "image": "/img/discord-badges/legacy-username.png",
    "group": "legacy",
    "keywords": "дискорд значки архив прежний ник имя",
    "automatic": false
  },
  {
    "id": "last-meadow",
    "label": "Last Meadow Online",
    "image": "/img/discord-badges/last-meadow.png",
    "group": "legacy",
    "keywords": "дискорд значки архив",
    "automatic": false
  },
  {
    "id": "lootbox",
    "label": "A clown, for a limited time",
    "image": "/img/discord-badges/lootbox.svg",
    "group": "legacy",
    "keywords": "дискорд значки архив клоун лутбокс",
    "automatic": false
  },
  {
    "id": "moderator-legacy",
    "label": "Discord Certified Moderator · архив",
    "image": "/img/discord-badges/moderator-legacy.svg",
    "group": "legacy",
    "keywords": "дискорд значки архив",
    "automatic": false
  },
  {
    "id": "partner-legacy",
    "label": "Discord Partner · архив",
    "image": "/img/discord-badges/partner-legacy.png",
    "group": "legacy",
    "keywords": "дискорд значки архив",
    "automatic": false
  },
  {
    "id": "house-balance-gold",
    "label": "HypeSquad Balance · Snowsgiving",
    "image": "/img/discord-badges/house-balance-gold.svg",
    "group": "legacy",
    "keywords": "дискорд значки архив",
    "automatic": false
  },
  {
    "id": "house-balance-koth",
    "label": "HypeSquad Balance · King of the Hat",
    "image": "/img/discord-badges/house-balance-koth.svg",
    "group": "legacy",
    "keywords": "дискорд значки архив",
    "automatic": false
  },
  {
    "id": "supports-commands",
    "label": "Supports Commands",
    "image": "/img/discord-badges/supports-commands.svg",
    "group": "apps",
    "keywords": "дискорд значки архив",
    "automatic": false
  },
  {
    "id": "automod",
    "label": "Uses AutoMod",
    "image": "/img/discord-badges/automod.svg",
    "group": "apps",
    "keywords": "дискорд значки архив",
    "automatic": false
  },
  {
    "id": "verified-bot",
    "label": "Verified Bot / App",
    "image": "/img/discord-badges/verified-bot.svg",
    "group": "apps",
    "keywords": "дискорд значки архив",
    "automatic": true
  },
  {
    "id": "premium-bot",
    "label": "App Premium",
    "image": "/img/discord-badges/premium-bot.png",
    "group": "apps",
    "keywords": "дискорд значки архив",
    "automatic": false
  }
].map(Object.freeze));
  const byId = Object.freeze(Object.fromEntries(items.map(item => [item.id, item])));
  function normalize(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter(id => typeof id === 'string' && Object.hasOwn(byId, id)))].slice(0, 32);
  }
  window.IwtxzDiscordBadges = Object.freeze({ items, groups, byId, normalize, maximum: 32 });
})();
