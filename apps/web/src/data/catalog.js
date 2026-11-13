/**
 * Store catalogue — PLACEHOLDER DATA taken from the Stitch design mockups
 * (names, prices, copy and photos). Phase 3 moves this into the database
 * (Supabase); pages read it only through src/lib/catalog.js, so only that
 * module changes then.
 *
 * image: {src, alt} for a remote photo, or {local, alt} for a file in
 * src/assets/products/<local>.webp.
 * tryOn: the /try-on category whose 3D model matches this product (only set
 * where a matching model exists), with sku = the try-on catalogue key.
 */

/** @typedef {{src?: string, local?: string, alt: string}} ImageRef */
/** @typedef {{slug: string, name: string, blurb: string, image: ImageRef}} Category */
/**
 * @typedef {Object} Product
 * @property {string} slug
 * @property {string} sku
 * @property {string} name
 * @property {string} category - Category slug
 * @property {number} priceInr - whole rupees, GST inclusive
 * @property {string} label - small caps line above the name
 * @property {string} detail - spec shown beside the price
 * @property {ImageRef} image
 * @property {'ring'|'earring'|'necklace'|'nose'|null} tryOn
 * @property {string} description
 */

/** @type {Category[]} */
export const CATEGORIES = [
  {
    "slug": "rings",
    "name": "Rings",
    "blurb": "Solitaires, bands and heirloom rings",
    "image": {
      "src": "https://lh3.googleusercontent.com/aida/AEtjO1UJcRo61jKAm8_nfTiTz12l64Aj00akg5lHNVWC8zTwzaTSC0FBw4L566neH_KzElo4HR4FYBNrMcvslMz1AzuSLPs4Ei7WTlUG3b5Mck3WZhxt8r3wsnROq8ASBSn43vfVVeEkzv3JE0hg3btYoNBbKUIyoG1-cu9_XTQdG7wRODPLXRGHApjryE3-cKQEz0mBXme3q5TFaeN31GMuUlXXup6dP7OQHF_DnFU30wJkWzRudu-xlcFQkg",
      "alt": "Luxury diamond solitaire ring with brilliant round cut resting on an ivory textured limestone plinth in ambient lighting"
    }
  },
  {
    "slug": "earrings",
    "name": "Earrings",
    "blurb": "Studs, hoops, drops and ear stacks",
    "image": {
      "src": "https://lh3.googleusercontent.com/aida-public/AB6AXuCueZnRJ6JLnXbUDiAUJdWGPZ2WWE5f6u7U3HrSuv8V092SMlhMlssq0e2IQ28SmDe2NgNuc28vXBFeksROLv3JlgxIglhIw7NLaH45rFjT6y63_0xYCqvBD2wb7wMdEVgzxVGKkyV2saLOrgs2dC85XTkTPF-UXuN_g9TF8kH41rLFW_tP_TNk8g_x8iEBgY8bbNUHHpWk6tOhDKuK9VxCpbYR8nlG9iN-0-Nti3FXsOKKt-DMFBDB",
      "alt": "Close up photograph of sculptural 18-karat gold cascade earrings set with pear-cut brilliant diamonds resting on rich cocoa brown velvet surface"
    }
  },
  {
    "slug": "necklaces",
    "name": "Necklaces",
    "blurb": "Chains and pendants",
    "image": {
      "src": "https://lh3.googleusercontent.com/aida-public/AB6AXuAngsjOemfFYZIOcJAUrNpmbpFYs2CpjzpMXBYYsEtRIEOzgVXfNqKIzgmaMVy7Em8SMlawBaWiViY4AS_T-D5R62U8HS-VL0KbIZN-c8zTtI5DtiOTL8oXnmjIGdjGDL7_iXs3xlw1DzgtN_4oOJ2DN7zOj7-rnNJNlswyVnwWxlBfG2KYIG0OUWJ0anCWAMEKHeVjnaG4pMnra0cK4re3WNQZ64ooV7ZjO2O-6ZG3RjM5MQs6tNFc",
      "alt": "Overhead luxury photograph of a fine yellow gold delicate chain necklace with bezel set round diamond solitaire on dark warm stone slab"
    }
  },
  {
    "slug": "bracelets",
    "name": "Bracelets",
    "blurb": "Tennis bracelets and bangles",
    "image": {
      "src": "https://lh3.googleusercontent.com/aida-public/AB6AXuBjTG_R-_VyPEBcI8rrtdP1GKoBRKtjHC93Zmsy18e69wLetRW3ISJ8N3ZEs63B7YqWcQX89Bdnubs7WXNXERAoGq-cziDEiZTcO0paCvIWnMVSQqBvb9ym6O1wDrbGTZJd4bYLU76mz5QX8l7mGmGJOzduEqCw67svsXtTp_8HaO1GrKqyfQQ3MhbR8D0UX-MUkHFGtxleO2vvfzBpZ-8sFKX0Z-mrMp21iwd8wwa6I6PbVQ3bLD2z",
      "alt": "Editorial still life of solid warm gold architectural bangles and pavé diamond cuff bracelets arranged delicately on espresso colored silk fabric"
    }
  },
  {
    "slug": "nose-rings",
    "name": "Nose Rings",
    "blurb": "Nose pins and hoops",
    "image": {
      "local": "pointed-nose-ring",
      "alt": "Pointed nose ring"
    }
  }
];

/** @type {Product[]} */
export const PRODUCTS = [
  {
    "slug": "celeste-solitaire-ring",
    "sku": "CELESTE-SOLITAIRE-RING",
    "name": "Celeste Solitaire Ring",
    "category": "rings",
    "priceInr": 38500,
    "label": "Solitaire · Brilliant cut",
    "detail": "0.75 ct IGI",
    "image": {
      "src": "https://lh3.googleusercontent.com/aida-public/AB6AXuB7OPfWs8qGNPuT9MhW85Hg0j8B78eJV77vgJq955LBddRFmoCzEF-rrGGGivVTCw-V1NbdrDV6uVZV6qvdbBcq-y4Qq5dSyd_yf0Vt7COkmZbfrVU8lsNNENUsYyFjhb3qFV3lfBm26JDowttb20nln-q6ln327KkC3a3SBAK6Lih0JKwF_xx7z1SvQouMojIWDHUBOnqq2EXOyG5Ka4oTpmbgbJHRL4ScbzT5s51K8sT60FIHV9_Q",
      "alt": "Celeste Solitaire Ring in handcrafted platinum setting with four delicate prongs holding a brilliant cut diamond in dramatic velvet lighting"
    },
    "tryOn": "ring",
    "description": "A brilliant-cut centre diamond raised in a four-prong cathedral setting on a hallmarked 18K gold band. Our signature solitaire, finished by hand in our master studio."
  },
  {
    "slug": "aurelia-diamond-band",
    "sku": "AURELIA-DIAMOND-BAND",
    "name": "Aurelia Diamond Band",
    "category": "rings",
    "priceInr": 24900,
    "label": "18K solid gold",
    "detail": "0.42 ct VVS1",
    "image": {
      "src": "https://lh3.googleusercontent.com/aida-public/AB6AXuCGMIuYSCoKrsbVLREpaDlIvrrHhatO3pj52Ttgqp1drZYNjv8brgl56gDODvye8v0fptKa-r6zW5vaI6XbK157ONN0ogV8BzrDOExmvHZfSZkLDX_sDCYXYj9-m2jdPJpB5JILubaw64CvM8Vt89-UoUOwaaysV3SMBHFeP-BLmPYf0N3MyXe-fwCavYv-_58pUjdEZjBMsP_MZmgzWqqyW3fKuFfLAr3SWsS79lDNEhsLIUB_93I0",
      "alt": "Aurelia Diamond Band"
    },
    "tryOn": null,
    "description": "A slim band of hand-set diamonds in 18K solid gold, made to be worn alone or stacked."
  },
  {
    "slug": "kavya-heirloom-ring",
    "sku": "KAVYA-HEIRLOOM-RING",
    "name": "Kavya Heirloom Ring",
    "category": "rings",
    "priceInr": 46500,
    "label": "Heirloom",
    "detail": "0.90 ct certified",
    "image": {
      "src": "https://lh3.googleusercontent.com/aida/AEtjO1UJcRo61jKAm8_nfTiTz12l64Aj00akg5lHNVWC8zTwzaTSC0FBw4L566neH_KzElo4HR4FYBNrMcvslMz1AzuSLPs4Ei7WTlUG3b5Mck3WZhxt8r3wsnROq8ASBSn43vfVVeEkzv3JE0hg3btYoNBbKUIyoG1-cu9_XTQdG7wRODPLXRGHApjryE3-cKQEz0mBXme3q5TFaeN31GMuUlXXup6dP7OQHF_DnFU30wJkWzRudu-xlcFQkg",
      "alt": "Kavya Heirloom Ring featuring an archival solitaire cut diamond in a hand-sculpted gold basket on a light travertine surface"
    },
    "tryOn": null,
    "description": "An archival-cut solitaire in a hand-chased gold setting, designed to be passed down."
  },
  {
    "slug": "elan-gold-hoops",
    "sku": "ELAN-GOLD-HOOPS",
    "name": "Élan Gold Hoops",
    "category": "earrings",
    "priceInr": 18750,
    "label": "18K solid gold",
    "detail": "14.2 mm drop",
    "image": {
      "src": "https://lh3.googleusercontent.com/aida-public/AB6AXuBjfrntns5HS3ebx-jCE4hZDaXssFZuM99H3MDwJju04FOVR2zdhhz1-YiVUSBg_NkhiIVEGauLJi5XlxV1rHb6cA_0Yk4pNtHbGX5GJBu2i9iBt7E3UIZh3F-NTe7kHEVmzzmqrNzsTYBbJ1CL-uX6noj4IdAPJ4t5X3XhRrXymFzi86PtjcAcV6V1z-DgHMnvVPYcCug3J58lCiHxOXIsgHV_tKgq0t5nX1t1khEVkmOJOoko9yjJ",
      "alt": "Élan Gold Hoops with diamond pavé accents along the outer rim resting gracefully on dark cocoa linen fabric"
    },
    "tryOn": null,
    "description": "Sculpted 18K gold hoops with a line of pavé diamonds along the outer rim."
  },
  {
    "slug": "sovereign-solitaire-studs",
    "sku": "SOVEREIGN-SOLITAIRE-STUDS",
    "name": "Sovereign Solitaire Studs",
    "category": "earrings",
    "priceInr": 31200,
    "label": "Solitaire studs",
    "detail": "Pair",
    "image": {
      "src": "https://lh3.googleusercontent.com/aida-public/AB6AXuD68b7rPsMpgDzyuqwLQ-d8_qWmLAYOdcrLtSpE6RZHDdvW0_mMlt3SYtLd6k72UCDa3bPzoqsJIov12im3MVTgzXFwr08if8kC8rfbs4z0LAg1pz-GHrKVoW2zdSn11Rv-TQjCyT4bqg7ltle14_pipWF6IqM19O7x6paTYL1u5br-u8nduUm9_WOx8SWJIY1ZKhEl5NvaTvlSB8RTnuT3MMYMtTmmcitxJGRN44cbPIP2KhiOqo1g",
      "alt": "Sovereign Solitaire Studs in 18K solid yellow gold setting glistening on clean warm sandstone pedestal in delicate daylight"
    },
    "tryOn": null,
    "description": "A matched pair of brilliant-cut diamonds in four-prong 18K gold settings."
  },
  {
    "slug": "golden-ball-drop-earrings",
    "sku": "GOLDEN-BALL-CRYSTAL-DROP-EARRINGS",
    "name": "Golden Ball Drop Earrings",
    "category": "earrings",
    "priceInr": 12900,
    "label": "Gold drop",
    "detail": "48 mm length",
    "image": {
      "local": "golden-ball-drop-earrings",
      "alt": "Golden Ball Drop Earrings"
    },
    "tryOn": "earring",
    "description": "Polished gold spheres beneath a faceted crystal, on fine French hooks. Try them on live with your camera."
  },
  {
    "slug": "classic-huggie-hoop",
    "sku": "CLASSIC-HUGGIE-HOOP",
    "name": "Classic Huggie Hoop",
    "category": "earrings",
    "priceInr": 11900,
    "label": "14K solid gold",
    "detail": "Lobe stack",
    "image": {
      "src": "https://lh3.googleusercontent.com/aida-public/AB6AXuCueZnRJ6JLnXbUDiAUJdWGPZ2WWE5f6u7U3HrSuv8V092SMlhMlssq0e2IQ28SmDe2NgNuc28vXBFeksROLv3JlgxIglhIw7NLaH45rFjT6y63_0xYCqvBD2wb7wMdEVgzxVGKkyV2saLOrgs2dC85XTkTPF-UXuN_g9TF8kH41rLFW_tP_TNk8g_x8iEBgY8bbNUHHpWk6tOhDKuK9VxCpbYR8nlG9iN-0-Nti3FXsOKKt-DMFBDB",
      "alt": "Solid Gold Classic Huggie Hoop"
    },
    "tryOn": null,
    "description": "A close-fitting solid gold huggie for everyday wear and ear stacks."
  },
  {
    "slug": "pave-curved-crawler",
    "sku": "PAVE-CURVED-CRAWLER",
    "name": "Pavé Curved Crawler",
    "category": "earrings",
    "priceInr": 22500,
    "label": "Natural diamond",
    "detail": "Cartilage",
    "image": {
      "src": "https://lh3.googleusercontent.com/aida-public/AB6AXuBGK4wsAvEaRerpfZCP_10-4LKdVR7XUTZu8bukttkxRAgbqnDX3yub5VWBR491Xrdjv1sRhhhdzEcPKx61S5kHEtV0pj8snFgL_M75uESUaE8mqOhad18jLcCkrb9S1yI7VD9zsE_X4LkauhVVgo_h7nY0ZM5LXr_ZKW5aZIS8o8QlYKwrjazssymHrGpaT3rfM5GKPckoQs4f8MZJ6VUs04JXsamz3deOiiJ7asRi9Ayx56pLP24G",
      "alt": "Pavé Curved Ear Crawler"
    },
    "tryOn": null,
    "description": "A curved line of pavé diamonds that climbs the ear."
  },
  {
    "slug": "minimalist-bold-cuff",
    "sku": "MINIMALIST-BOLD-CUFF",
    "name": "Minimalist Bold Cuff",
    "category": "earrings",
    "priceInr": 14200,
    "label": "No piercing needed",
    "detail": "Mid ear",
    "image": {
      "src": "https://lh3.googleusercontent.com/aida-public/AB6AXuBjTG_R-_VyPEBcI8rrtdP1GKoBRKtjHC93Zmsy18e69wLetRW3ISJ8N3ZEs63B7YqWcQX89Bdnubs7WXNXERAoGq-cziDEiZTcO0paCvIWnMVSQqBvb9ym6O1wDrbGTZJd4bYLU76mz5QX8l7mGmGJOzduEqCw67svsXtTp_8HaO1GrKqyfQQ3MhbR8D0UX-MUkHFGtxleO2vvfzBpZ-8sFKX0Z-mrMp21iwd8wwa6I6PbVQ3bLD2z",
      "alt": "Minimalist Bold Ear Cuff"
    },
    "tryOn": null,
    "description": "A bold, polished ear cuff that slides on without a piercing."
  },
  {
    "slug": "micro-solitaire-stud",
    "sku": "MICRO-SOLITAIRE-STUD",
    "name": "Micro Solitaire Stud",
    "category": "earrings",
    "priceInr": 16800,
    "label": "Solitaire accent",
    "detail": "Single",
    "image": {
      "src": "https://lh3.googleusercontent.com/aida-public/AB6AXuD68b7rPsMpgDzyuqwLQ-d8_qWmLAYOdcrLtSpE6RZHDdvW0_mMlt3SYtLd6k72UCDa3bPzoqsJIov12im3MVTgzXFwr08if8kC8rfbs4z0LAg1pz-GHrKVoW2zdSn11Rv-TQjCyT4bqg7ltle14_pipWF6IqM19O7x6paTYL1u5br-u8nduUm9_WOx8SWJIY1ZKhEl5NvaTvlSB8RTnuT3MMYMtTmmcitxJGRN44cbPIP2KhiOqo1g",
      "alt": "Micro Solitaire Stud"
    },
    "tryOn": null,
    "description": "A tiny solitaire stud for second and third piercings."
  },
  {
    "slug": "mira-diamond-pendant",
    "sku": "MIRA-DIAMOND-PENDANT",
    "name": "Mira Diamond Pendant",
    "category": "necklaces",
    "priceInr": 42000,
    "label": "Neckpiece",
    "detail": "0.60 ct G colour",
    "image": {
      "src": "https://lh3.googleusercontent.com/aida-public/AB6AXuDEBrjIWgjQ4TYytxnYOHxi5xnpKepz0SgvCRWEoJcw0Hd-QvPGIVcUG8fOtYIO1pInoxgkr0UVTjh4C--Kq69iO5AM8pizbUjRnHs-kSZiexnSjaTW3sK4xLr9I2hvnGAcqRHcKHyEl4-g_NlW7Yc05rzDN-cWHmKOa9uQBwakOFAXG_EqnCPx_DCOtddtvwoWn4D-AHbRMNFQ98XqmGr6cU3RaLHSG6b_N9QJ3pRU_bVL046ie9RZ",
      "alt": "Mira Diamond Pendant necklace with floating halo diamond on a fine 18-karat gold trace chain displayed on dark warm wood surface"
    },
    "tryOn": null,
    "description": "A floating halo diamond on a fine 18K gold chain."
  },
  {
    "slug": "lumina-layered-chain",
    "sku": "GOLD-NECKLACE-CHAIN",
    "name": "Lumina Layered Chain",
    "category": "necklaces",
    "priceInr": 29800,
    "label": "18K solid gold",
    "detail": "Adjustable 16–18\"",
    "image": {
      "src": "https://lh3.googleusercontent.com/aida-public/AB6AXuAzNZM2WTChu48KKxzBWJNpbbqFbHs4FmkexkpBhEDu0Y4c3XbMPzGFl9JaytUpWZxz3nQOK1IcmrT3lN-BKxmv8g_WnS7suyyug4lzvwZM4NKlAd3OPMZcOMm3ZXm9d3a-8_PN2ykm6R0aaxwGEN_-COvOk8bapNS-Gxb9ptzI1AS40zqC7a9Ml9j0QUFEdwrDgK_vfdagLxvgv4PylHSfVvO4hl1TZ011K3OobzwPK_gQ6B5vj8wH",
      "alt": "Lumina Layered Chain in 18K solid yellow gold with faceted gold links cascading over dark obsidian stone backdrop"
    },
    "tryOn": "necklace",
    "description": "Faceted 18K gold links that catch the light. Try it on live with your camera."
  },
  {
    "slug": "aria-pave-tennis-bracelet",
    "sku": "ARIA-PAVE-TENNIS-BRACELET",
    "name": "Aria Pavé Tennis Bracelet",
    "category": "bracelets",
    "priceInr": 54000,
    "label": "Wristwear",
    "detail": "1.25 ct total",
    "image": {
      "src": "https://lh3.googleusercontent.com/aida-public/AB6AXuDIRXBTkl_aHR0xL-zjt06R3e7p6c9f4wZMVjiBWLQHTUoKWTBwRQFLOVday-Vfev8vLcaNqEjGdfB6cAnYOvSrooQJTZTb7fBF-jC56r1tMdTATG9Tbgdq0A6PCGCh6jBa4QLx-BVYdB-nmGtBmJ09Lsc2OFenqL15DOxtcyAxkKhX_AxqCDnhBBf2o210dhU7vfHWw4mL1F0yu1fTBBiXkoI3hDtasMK12WtdgrnB6jhD5jeHJcKI",
      "alt": "Aria Pavé Tennis Bracelet in white gold set with continuous line of pavé diamonds resting smoothly on rich chocolate brown velvet"
    },
    "tryOn": null,
    "description": "A continuous line of pavé diamonds in white gold."
  },
  {
    "slug": "pointed-nose-ring",
    "sku": "POINTY-NOSE-RING",
    "name": "Pointed Nose Ring",
    "category": "nose-rings",
    "priceInr": 4500,
    "label": "Sterling silver",
    "detail": "12 mm",
    "image": {
      "local": "pointed-nose-ring",
      "alt": "Pointed Nose Ring"
    },
    "tryOn": "nose",
    "description": "A slim open hoop with pointed ends. Try it on live with your camera."
  }
];

/** Editorial (non-product) photography used on the home page. */
export const EDITORIAL = {
  "hero": {
    "src": "https://lh3.googleusercontent.com/aida-public/AB6AXuBMd0Iha4bsJwADbnKiEaBJShbDYJetNbd9hh2cbMGA9vK8IlkoOY_BeY1SixFtBKBpVQJwMZvfd16eS-o2flp-SaiDtwQgujERsHlq5FIPRqQM_fVWHu2OBp_-UAgFyauf5dm_AOZOx_ejd7YNq7AItDRNuErjm3CbmwLpj3LUqJ_iG40l5M8Rg2MN6_r_QNpHxEirTp0-adHFePOKnf9gtnhA1Qo-x0s1POHZbxME49QXWMfWIDml",
    "alt": "Editorial portrait of an elegant woman wearing fine jewelry"
  },
  "moments": {
    "src": "https://lh3.googleusercontent.com/aida/AEtjO1XP9DPUt7Q1Db_Qm2h-yJT7buRHsX7xRmglf1P7iq5T897AurIE7HeD3HUn3Hb4JjNi571ybsz0c94biCfTtrYRGxTdEtFCog7VfluAVYfpf33ONKsJFsTnzGrBMDkbSNadwDjPBibeH3wl_SgSIDmJB3gsaLUErBZPYLsDUAMh24b9ky9h0Zey53sn-mZuTBKKpruvSAIunokmrusvqVbcCmVeTyEPEozuJChOWPJdAtgWINKPcJ2Hfg",
    "alt": "Made for Your Moments - Caen Fine Jewelry Craftsmanship"
  },
  "stack": {
    "src": "https://lh3.googleusercontent.com/aida-public/AB6AXuASYjpWI2RLKv7sPL4fVUeY7Tmqpm-Af1KZkVLTonYAShi2D86ry70gwofIyJ3W1KH6HJ_zfbY4j84Gx0SahXzdTeTqngC11-d73-UvhyDN3hft_Kn2br3h5BKFeT3Mo5G108-9HwMA0H1WMEFRsFeedUE7g39IPcQUaZnTtXouMx4xaCezlcC3DwT4RwmDxc5PgKjid0fjVyNLtVVsKCuaNyhVyNJ3uBRuVIo3yazqZcjTsIMlBdKS",
    "alt": "Sculptural stacked gold and diamond rings collection"
  },
  "pendants": {
    "src": "https://lh3.googleusercontent.com/aida-public/AB6AXuA1ubA14IL9AWmynYMxpcD8b9vzl6DI05fpCRl6aV20kWZ1skmr2UYXOwOF3U70AW3ARgrBAUME7IgkD9tIQy6pHQzuECCfgBnXMIe4r02j0LOlvamzG8YCSRUKyKyh36TVRaXlYz1IsOGbcI34saWfnxxpv4WkxTSF4pkMK0zMPYFUCGO3ng0GSbr0zOi4o73xle7DsZyKbktc8E8Xr3Isylcwv_fnaRpFCM2wT893ikOsGMFx6GB_",
    "alt": "Modular gold and gemstone pendant necklace collection"
  },
  "earStack": {
    "src": "https://lh3.googleusercontent.com/aida-public/AB6AXuCeTuPrAf8ACN1poT0B_t8uti2y07kivwPjTOub3OEwfrDKMm2k_gY4n5HQ2fhd64bTpYadgGf8R_cbD8DF4HYdeOsF6O9zHqYTWok1FOlGO-cDHYVXsCTmoCTlwWHCZW7eNvO-mQ9WQTRzLg2g9uNvMiL2OE0H-CzYkuA9yhqg4PM1BaOEd303Cd89He7ZPS5HRh75DczusOTQ4YT0gdOWRqKL9wYYTqMMgSSSZFooLRiUqa4Jh_h9",
    "alt": "Curated luxury fine ear stack with gold huggies and diamond crawler"
  },
  "engagement": {
    "src": "https://lh3.googleusercontent.com/aida-public/AB6AXuCuLYkTp9-ajVNag5-uOfOCBHjKtOMNcspV-0WY93zGRECxEbVaAtOyENg27dCUqKwCObglvfKJhaPjGIBorY9VZwbDVk4N3uJYkXJC7vArHLyymvvMIgESjDmtN_eDFTlj_RZTzikHzRLbCL-uuB50nGrfDlRjcsPcoQzTfEMUza5vghOq-U1JNRZEBV1L-Pr6bQrBN7AiezNjIfipU-jLbdRntTyCgBq0hVGMB0-9kjmuhVycpzza",
    "alt": "Engagement occasion fine jewelry"
  },
  "wedding": {
    "src": "https://lh3.googleusercontent.com/aida-public/AB6AXuCzCMw3eQiwjsQxZeyAj3MBV9K_YEDmvU7umDDd6d4CxRG2K_csFIaKHZD8s8fOA3FIx9FO4_04muQfXdhM1HZ7TwBqceZVZbimw5eJeX9cV9YhoT9RiSEAi3WRkoC5Qu4l-IqN6zSCmjq7JgCPlZbjwQbcjGYOGBPb-zcUDoSLhiKIjLYHW4aMjGv5O5zJQTzWSqY1Y6duW289PVB6q7BkkqUGCkgcJxdsgpBnSvJ_jV1ARVswTDPl",
    "alt": "Wedding occasion fine jewelry"
  },
  "valentines": {
    "src": "https://lh3.googleusercontent.com/aida-public/AB6AXuDacWAkfMtI5DukHVN_K_E_mg74YZ9bSREWQFWtythNin8yssdYrbC4hS_eRVdiZzVU6nYeOFd8m1oz2LvgpKLT6MQcv0I7UQWDylZmsOsM_-a7hgv7zHw9deljvRkQzugjmkRlmUhM4PrEi2mJANaihvbsQh6O-3W_K6pbG11aJXMaIeNjQmZhVE0cZ9Yob2l8Bs2jDiTQavPZNz8andXST8jxXmzxVZ9Ppp0E1XZ4K02fLgvINW3b",
    "alt": "Valentine's occasion fine jewelry"
  },
  "anniversary": {
    "src": "https://lh3.googleusercontent.com/aida-public/AB6AXuDsUiOsi_rOuuvmxqv8Cay6Oyo1AYdF2uhC7BJ7LVzpWBS1tgnY-tlSYIhn7R6qpiWEMg93N7TlrdCDprGfGW3D0IRrjciCYuAmL3zfXx5NF8FTUdioHeM4DF_0nxq2QHZas7P9F2loqyS5G6CL6D_v-SANQmY6ILbde2Q0us6OALL9RIyAqe0_ez3C885xHL_ceCKXSs-U8aeByyYyLHMxztEC6nZf7GjM5m4mmpoqIXXM_NrR6u_T",
    "alt": "Anniversary occasion fine jewelry"
  }
};
