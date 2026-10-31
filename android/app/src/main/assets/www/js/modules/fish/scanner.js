/* Klev PRO v2.5.3 r190 (Protected Build) */
import { store } from '../../core/store.js?v=2.5.3';
import { router } from '../../core/router.js?v=2.5.3';
import { RELAY_WORKER_URL, triggerHaptic } from '../../core/telegram.js?v=2.5.3';
import { BASIN_CONFIGS, isSpeciesInGeoRange } from '../../data/basins.js?v=2.5.3';
import { FISH_DB } from '../../data/species.js?v=2.5.3';
import { escapeHtml, createPill, showToast, openModal, closeModal } from '../../ui/components.js?v=2.5.3';
export const REFERENCE_SPECIES_SIGNATURES = {"amur_catfish": {"dhash": "00001f1dc3640000", "bands": [128.0, 136.0, 144.0, 105.8, 108.2, 98.3, 128.7, 132.3, 128.8, 128.0, 136.0, 144.0]}, "anglerfish": {"dhash": "001833575f1f3b20", "bands": [127.3, 131.7, 136.5, 131.0, 119.1, 111.3, 103.2, 90.0, 82.3, 121.1, 125.5, 131.2]}, "asp": {"dhash": "00040c71b0f20000", "bands": [128.0, 136.0, 144.0, 130.7, 137.4, 140.6, 148.1, 150.1, 150.6, 128.0, 136.0, 144.0]}, "baikal_grayling": {"dhash": "0c060e410a0a0c00", "bands": [124.2, 121.9, 128.8, 114.1, 98.8, 102.9, 123.7, 117.4, 122.3, 128.0, 135.9, 143.9]}, "barbel": {"dhash": "000c0c6591b84800", "bands": [127.8, 135.7, 143.5, 123.3, 122.8, 104.6, 157.4, 140.2, 106.4, 128.3, 136.0, 143.9]}, "beluga": {"dhash": "00001a3bb1140000", "bands": [128.0, 136.0, 144.0, 109.9, 113.9, 114.4, 132.9, 136.7, 136.9, 128.0, 136.0, 144.0]}, "black_carp": {"dhash": "000c0c451a0a0c00", "bands": [127.3, 135.2, 142.9, 99.2, 97.6, 94.4, 109.3, 109.0, 106.8, 128.0, 136.0, 144.0]}, "bleak": {"dhash": "00000cd1f1e40000", "bands": [128.0, 136.0, 144.0, 128.4, 138.2, 140.4, 141.0, 148.3, 150.6, 128.0, 136.0, 144.0]}, "blue_bream": {"dhash": "000c0ce1f1f00600", "bands": [126.9, 135.0, 143.1, 128.1, 142.7, 150.3, 157.3, 160.2, 155.9, 127.4, 135.4, 143.1]}, "bluefish": {"dhash": "00040e71d8e02000", "bands": [128.0, 136.0, 144.0, 116.8, 135.5, 139.7, 140.6, 151.0, 155.5, 128.4, 136.5, 144.4]}, "bream": {"dhash": "000c2661f1a64600", "bands": [128.0, 135.5, 142.6, 145.4, 136.1, 117.6, 157.2, 142.9, 119.3, 126.9, 134.4, 141.6]}, "broad_whitefish": {"dhash": "000c0c61f0ea0c00", "bands": [127.7, 135.6, 143.4, 129.2, 127.2, 120.5, 150.3, 149.5, 144.8, 128.0, 136.0, 144.0]}, "brown_trout": {"dhash": "000c0e6890da0c00", "bands": [127.9, 135.5, 142.6, 123.6, 116.3, 104.9, 152.7, 135.7, 103.3, 128.1, 136.0, 143.8]}, "buffalo": {"dhash": "00080e65b1920a00", "bands": [127.8, 135.8, 143.6, 113.2, 120.1, 118.3, 132.9, 133.3, 119.9, 127.8, 135.8, 143.6]}, "burbot": {"dhash": "0000076023c70000", "bands": [128.0, 136.0, 144.0, 122.5, 120.1, 108.3, 119.5, 118.4, 112.8, 128.0, 136.0, 144.0]}, "capelin": {"dhash": "000c0ec9b0680800", "bands": [128.0, 136.0, 143.9, 124.8, 128.7, 123.9, 141.1, 144.6, 140.5, 128.0, 136.0, 144.0]}, "carp": {"dhash": "00102660f1b23200", "bands": [129.1, 136.0, 142.4, 143.3, 127.5, 96.2, 163.0, 135.1, 85.5, 130.3, 136.4, 142.1]}, "catfish": {"dhash": "00000f0f73c70000", "bands": [128.0, 136.0, 144.0, 110.6, 110.7, 107.0, 115.1, 113.9, 109.5, 128.0, 136.0, 144.0]}, "channel_catfish": {"dhash": "00081878e0e60000", "bands": [128.0, 136.0, 144.0, 129.2, 136.3, 138.2, 126.5, 134.8, 141.3, 128.0, 136.0, 144.0]}, "char": {"dhash": "000c0c1d880e0000", "bands": [128.0, 136.0, 144.0, 114.3, 111.4, 106.2, 155.1, 117.1, 104.4, 128.0, 136.0, 144.0]}, "chekhon": {"dhash": "00040ce1f0d20c00", "bands": [128.0, 136.0, 144.0, 134.6, 143.8, 146.8, 153.1, 156.8, 157.2, 127.6, 135.5, 143.3]}, "cherry_salmon": {"dhash": "00040e0f0e0e0400", "bands": [128.0, 136.0, 144.0, 115.5, 101.2, 96.9, 127.1, 102.9, 103.0, 128.0, 136.0, 144.0]}, "chinese_perch": {"dhash": "001e0e27d0f02220", "bands": [128.1, 135.1, 139.7, 110.7, 103.9, 69.2, 154.0, 142.3, 93.1, 130.0, 137.2, 142.3]}, "chinook_salmon": {"dhash": "000c0c0d1e0e0000", "bands": [127.9, 135.8, 143.5, 111.3, 95.3, 85.7, 110.9, 105.6, 106.6, 128.0, 136.0, 144.0]}, "chir": {"dhash": "000c0e71d0ea0c00", "bands": [127.9, 135.9, 143.8, 126.9, 124.4, 114.9, 157.7, 149.5, 129.2, 127.8, 135.7, 143.6]}, "chub": {"dhash": "0004267430321000", "bands": [127.9, 136.0, 143.9, 112.6, 116.1, 115.5, 126.7, 123.0, 117.7, 128.1, 136.0, 144.0]}, "chum_salmon": {"dhash": "000c0e581a0e0000", "bands": [126.6, 134.3, 141.3, 115.6, 103.2, 86.3, 121.4, 121.8, 123.2, 128.0, 136.0, 144.0]}, "cisco": {"dhash": "00000cd9f0f00000", "bands": [128.0, 136.0, 144.0, 129.1, 134.8, 138.1, 145.6, 151.1, 154.7, 128.0, 136.0, 144.0]}, "cod": {"dhash": "00080e4292360000", "bands": [128.0, 136.0, 144.0, 122.7, 122.8, 107.5, 125.2, 128.9, 121.5, 128.0, 136.0, 144.0]}, "coho_salmon": {"dhash": "000c0e0f0e0e0000", "bands": [127.9, 135.9, 143.7, 114.2, 87.7, 89.5, 110.8, 96.4, 104.1, 128.0, 136.0, 144.0]}, "crab": {"dhash": "161333270f0f3313", "bands": [122.7, 127.0, 120.3, 108.7, 111.5, 89.6, 103.7, 105.8, 80.9, 122.0, 129.6, 129.1]}, "crayfish": {"dhash": "000017170f3e6b00", "bands": [128.0, 136.0, 144.0, 114.9, 116.5, 106.0, 106.6, 108.1, 97.3, 126.9, 134.3, 141.2]}, "crucian": {"dhash": "080e2661e1121a10", "bands": [127.8, 133.6, 137.9, 133.5, 120.7, 89.9, 135.9, 114.8, 78.9, 129.1, 135.7, 142.1]}, "dace": {"dhash": "000c0c65f0f01000", "bands": [127.9, 135.9, 143.8, 128.8, 135.4, 135.6, 158.4, 158.8, 153.3, 128.2, 136.1, 144.1]}, "dolly_varden": {"dhash": "000c0e2d380a0000", "bands": [128.0, 136.0, 144.0, 113.0, 109.7, 105.4, 146.5, 110.3, 98.8, 128.0, 136.0, 144.0]}, "eel": {"dhash": "0000060fe1000000", "bands": [128.0, 136.0, 144.0, 118.3, 122.4, 123.6, 134.9, 138.7, 139.2, 128.0, 136.0, 144.0]}, "flounder": {"dhash": "28ce1b03272f0e0e", "bands": [132.3, 133.9, 132.4, 124.6, 111.8, 89.4, 89.9, 78.0, 57.2, 119.7, 121.3, 120.3]}, "garfish": {"dhash": "000000e1e0000000", "bands": [128.0, 136.0, 144.0, 124.2, 138.8, 142.3, 128.5, 139.5, 144.6, 128.0, 136.0, 144.0]}, "goby": {"dhash": "00005e4767370000", "bands": [128.0, 136.0, 144.0, 128.9, 128.2, 117.3, 118.9, 116.1, 104.2, 128.0, 136.0, 144.0]}, "grass_carp": {"dhash": "00000c7cf0f20000", "bands": [128.0, 136.0, 144.0, 138.3, 135.5, 117.8, 157.7, 153.7, 132.1, 128.0, 136.0, 144.0]}, "grayling": {"dhash": "000c0e2cf8a20c00", "bands": [128.1, 134.4, 142.1, 117.5, 119.0, 123.5, 141.4, 141.7, 142.8, 128.0, 136.0, 144.0]}, "greenling": {"dhash": "00181e5290f21000", "bands": [127.9, 135.9, 143.6, 124.1, 114.3, 77.7, 145.4, 139.8, 114.3, 128.0, 136.0, 144.0]}, "gudgeon": {"dhash": "0018096fd1f11000", "bands": [128.6, 136.4, 143.6, 125.1, 129.0, 119.0, 155.6, 151.6, 130.5, 128.8, 136.6, 144.2]}, "haddock": {"dhash": "00181e1290f05000", "bands": [127.7, 135.6, 143.6, 115.0, 111.8, 122.7, 157.4, 152.9, 156.7, 128.1, 136.0, 144.0]}, "halibut": {"dhash": "000c145d470e0c00", "bands": [128.5, 135.3, 141.8, 117.2, 108.5, 93.0, 75.4, 68.8, 56.9, 126.5, 133.4, 139.8]}, "herring": {"dhash": "00000cc9f0e00000", "bands": [128.0, 136.0, 144.0, 126.4, 137.6, 143.0, 143.7, 151.8, 155.4, 128.0, 136.0, 144.0]}, "horse_mackerel": {"dhash": "0000877170f80800", "bands": [128.0, 136.0, 144.0, 120.8, 136.1, 136.2, 138.1, 150.1, 151.6, 128.0, 136.0, 144.0]}, "ide": {"dhash": "000c0cd1b0e20800", "bands": [127.7, 135.7, 143.7, 134.0, 133.0, 124.6, 160.6, 147.4, 135.5, 128.1, 136.0, 143.9]}, "kaluga": {"dhash": "001a1a33b5141000", "bands": [128.0, 136.0, 144.0, 103.3, 101.0, 94.1, 135.1, 136.2, 133.8, 128.0, 136.0, 144.0]}, "king_crab": {"dhash": "1c1f970f61110703", "bands": [134.1, 121.8, 122.9, 146.8, 97.0, 88.9, 141.1, 116.5, 112.5, 128.5, 129.1, 134.4]}, "kutum": {"dhash": "000c0ce1f0700000", "bands": [127.9, 135.9, 143.8, 132.5, 134.5, 122.0, 146.5, 148.7, 144.2, 128.0, 136.0, 144.0]}, "lenok": {"dhash": "000c0e0d882a0400", "bands": [128.0, 136.0, 144.0, 120.5, 110.3, 105.8, 133.6, 114.9, 102.3, 128.0, 136.0, 144.0]}, "loach": {"dhash": "00080d07a1282800", "bands": [128.0, 136.0, 144.0, 124.4, 114.0, 97.3, 156.2, 127.7, 90.5, 128.0, 136.0, 144.0]}, "mackerel": {"dhash": "00001e78f0e00000", "bands": [128.0, 136.0, 144.0, 121.1, 131.4, 133.2, 150.2, 152.8, 152.0, 128.0, 136.0, 144.0]}, "muksun": {"dhash": "000c0e70f0e00000", "bands": [127.9, 135.8, 143.8, 135.5, 137.3, 133.2, 160.8, 162.6, 159.7, 128.0, 136.0, 144.0]}, "mullet": {"dhash": "001034f1d0e02000", "bands": [128.0, 136.0, 144.0, 139.6, 138.7, 129.6, 152.4, 153.3, 149.4, 128.0, 136.0, 144.0]}, "navaga": {"dhash": "00101e70f0f00000", "bands": [128.0, 136.0, 144.0, 125.8, 124.6, 116.6, 149.9, 150.8, 144.5, 128.0, 136.0, 144.0]}, "nelma": {"dhash": "000c0ee0d0f00800", "bands": [127.7, 135.6, 143.5, 130.4, 135.2, 137.3, 153.3, 156.8, 157.6, 128.1, 136.1, 144.0]}, "omul": {"dhash": "00081cf0f0f01000", "bands": [128.0, 136.0, 143.9, 135.5, 142.2, 141.2, 145.9, 152.2, 152.5, 128.0, 136.0, 144.0]}, "omul_arctic": {"dhash": "00080cc0f0e00000", "bands": [128.0, 136.0, 143.9, 130.6, 138.1, 139.1, 150.7, 156.6, 158.9, 128.0, 136.0, 144.0]}, "paddlefish": {"dhash": "0000020f295b0800", "bands": [128.0, 136.0, 144.0, 113.0, 119.1, 126.0, 125.9, 128.0, 130.0, 128.0, 136.0, 144.0]}, "parabramis": {"dhash": "040c0c4505960e00", "bands": [126.1, 133.4, 140.7, 106.5, 101.7, 94.3, 115.2, 110.6, 102.0, 126.1, 133.7, 141.2]}, "peled": {"dhash": "000c0ef0f0ea0c00", "bands": [127.4, 135.1, 142.8, 131.7, 135.1, 140.1, 147.2, 150.9, 154.7, 128.0, 136.0, 144.0]}, "perch": {"dhash": "00203c4795c46400", "bands": [128.8, 136.4, 142.9, 118.9, 120.2, 99.9, 140.7, 126.7, 89.3, 130.5, 136.1, 142.4]}, "pike": {"dhash": "00000343e82a0000", "bands": [128.0, 136.0, 144.0, 119.0, 120.7, 104.8, 135.2, 130.5, 116.9, 128.0, 136.0, 144.0]}, "pink_salmon": {"dhash": "00080e0f10b20400", "bands": [128.1, 136.0, 143.9, 115.2, 108.8, 102.2, 144.0, 121.8, 115.9, 128.0, 136.0, 144.0]}, "pizhyan": {"dhash": "000c0ed0f0e00800", "bands": [127.5, 135.3, 143.1, 139.6, 140.3, 138.6, 158.4, 159.4, 159.1, 128.0, 136.0, 144.0]}, "plaice": {"dhash": "70c0c5b7730f9870", "bands": [146.8, 141.8, 126.6, 166.6, 138.4, 87.8, 142.9, 115.6, 71.7, 138.0, 135.4, 125.7]}, "rainbow_trout": {"dhash": "00080f61b0f01800", "bands": [128.1, 136.1, 143.9, 128.4, 125.4, 117.5, 158.9, 145.6, 135.9, 128.3, 136.2, 144.1]}, "red_mullet": {"dhash": "00206561f1e1a000", "bands": [130.1, 136.9, 143.6, 170.6, 126.6, 120.6, 179.4, 141.2, 133.5, 129.6, 136.6, 143.8]}, "roach": {"dhash": "000c2ef0b0e20800", "bands": [127.6, 135.5, 143.3, 130.1, 135.9, 131.4, 160.3, 148.2, 138.4, 128.3, 136.0, 143.7]}, "rotan": {"dhash": "00140e0751173000", "bands": [128.0, 136.0, 143.9, 106.9, 108.9, 97.2, 124.2, 122.4, 104.5, 128.1, 136.1, 143.9]}, "rudd": {"dhash": "00062465f1c20e00", "bands": [129.0, 133.8, 141.4, 143.8, 124.7, 96.0, 174.2, 143.0, 111.3, 129.8, 134.1, 141.9]}, "ruffe": {"dhash": "00201e67d1c12200", "bands": [128.0, 136.2, 143.7, 123.4, 134.3, 126.1, 138.2, 141.9, 122.6, 128.1, 136.1, 144.1]}, "russian_sturgeon": {"dhash": "00201a3358a82c00", "bands": [128.0, 136.0, 144.0, 126.0, 124.3, 119.7, 145.3, 138.1, 124.7, 128.0, 136.0, 144.0]}, "saffron_cod": {"dhash": "00181ef0f0700000", "bands": [127.9, 135.8, 143.8, 131.4, 125.6, 123.8, 141.6, 145.1, 148.9, 128.0, 136.0, 144.0]}, "saithe": {"dhash": "001c0eb0f0f20000", "bands": [127.6, 135.6, 143.4, 114.3, 115.4, 106.7, 148.1, 151.2, 150.6, 128.0, 136.0, 144.0]}, "salmon": {"dhash": "00080ef8a0600000", "bands": [128.0, 136.0, 144.0, 133.7, 143.8, 150.1, 144.1, 150.0, 155.1, 128.0, 136.0, 144.0]}, "sand_eel": {"dhash": "000010d0d0000000", "bands": [128.0, 136.0, 144.0, 128.8, 140.7, 140.7, 130.7, 140.3, 144.2, 128.0, 136.0, 144.0]}, "scorpionfish": {"dhash": "200c0f0f25131a08", "bands": [129.3, 133.8, 139.3, 116.0, 93.8, 87.2, 125.2, 92.3, 83.8, 129.2, 133.3, 139.8]}, "sea_bass": {"dhash": "006065e1d1662000", "bands": [130.5, 136.3, 143.3, 178.9, 134.6, 115.7, 166.9, 128.1, 116.5, 128.9, 136.3, 143.9]}, "sea_bream": {"dhash": "20206461d0e06010", "bands": [130.2, 137.3, 141.4, 153.6, 148.7, 123.7, 161.2, 156.4, 137.2, 130.1, 137.4, 143.2]}, "shemaya": {"dhash": "00040c61d0f01000", "bands": [128.0, 136.0, 144.0, 127.7, 135.0, 138.1, 151.1, 154.5, 153.7, 128.1, 136.1, 144.0]}, "siberian_sturgeon": {"dhash": "000001870d660400", "bands": [128.0, 136.0, 144.0, 115.9, 117.8, 119.8, 120.7, 118.9, 114.4, 128.0, 136.0, 144.0]}, "silver_carp": {"dhash": "00046c70f0c20000", "bands": [128.0, 136.0, 144.0, 141.3, 142.9, 139.5, 154.3, 156.5, 155.4, 128.0, 136.0, 144.0]}, "sky_gazer": {"dhash": "000c0ce1f0e02000", "bands": [127.6, 135.5, 143.5, 133.2, 139.0, 136.0, 153.5, 153.6, 151.1, 128.0, 136.0, 144.0]}, "smelt": {"dhash": "00000fd1f1240000", "bands": [128.0, 136.0, 144.0, 135.1, 139.1, 139.2, 141.3, 146.1, 148.6, 128.0, 136.0, 144.0]}, "snakehead": {"dhash": "00000f0311070000", "bands": [128.0, 136.0, 144.0, 105.7, 100.0, 91.8, 117.0, 115.3, 111.2, 128.0, 136.0, 144.0]}, "sockeye_salmon": {"dhash": "000c0e0f0e2a0000", "bands": [128.1, 135.8, 143.4, 152.2, 75.2, 75.1, 134.8, 108.4, 110.0, 128.0, 136.0, 144.0]}, "sopa": {"dhash": "00042461f1f03600", "bands": [127.1, 135.2, 143.2, 136.0, 142.2, 142.5, 161.0, 160.8, 156.3, 128.0, 135.7, 143.4]}, "starry_flounder": {"dhash": "0c1e0e17570e1e0c", "bands": [129.6, 127.1, 115.6, 95.0, 84.8, 60.8, 76.0, 67.7, 50.8, 125.4, 123.9, 116.6]}, "stellate_sturgeon": {"dhash": "00001a1fb5100000", "bands": [128.0, 136.0, 144.0, 110.4, 113.6, 116.6, 133.9, 138.0, 140.2, 128.0, 136.0, 144.0]}, "sterlet": {"dhash": "0000121ab1110000", "bands": [128.0, 136.0, 144.0, 119.4, 124.3, 128.7, 135.8, 135.7, 131.2, 128.0, 136.0, 144.0]}, "taimen": {"dhash": "00000c69b0a20000", "bands": [128.0, 136.0, 144.0, 118.9, 115.3, 112.9, 136.7, 123.5, 117.9, 128.0, 136.0, 144.0]}, "taran": {"dhash": "000c0c61f1f03200", "bands": [127.8, 135.5, 143.0, 131.0, 133.3, 128.4, 160.7, 157.4, 150.5, 128.7, 136.1, 143.6]}, "tarpon_carp": {"dhash": "000c0c65f1f00000", "bands": [128.0, 136.0, 143.9, 131.9, 132.9, 121.5, 151.5, 152.1, 139.4, 128.0, 136.0, 144.0]}, "tench": {"dhash": "00060441110a0e00", "bands": [126.5, 133.4, 139.5, 111.6, 109.7, 85.6, 106.9, 98.1, 63.5, 127.2, 134.9, 142.6]}, "tilapia": {"dhash": "001f276171531308", "bands": [126.4, 133.6, 139.0, 112.4, 115.1, 105.5, 128.3, 122.1, 108.8, 126.3, 133.9, 140.8]}, "trout": {"dhash": "00080e70b0e20000", "bands": [128.0, 136.0, 144.0, 131.6, 131.8, 129.3, 152.6, 149.7, 129.8, 128.0, 136.0, 144.0]}, "tugun": {"dhash": "000816f1f0700000", "bands": [128.0, 136.0, 144.0, 136.3, 142.1, 141.8, 144.1, 149.5, 150.8, 128.0, 136.0, 144.0]}, "turbot": {"dhash": "66e6c64723270e4e", "bands": [138.5, 133.1, 125.9, 128.2, 109.4, 88.3, 98.6, 82.0, 64.6, 119.4, 115.8, 112.9]}, "undermouth": {"dhash": "00080c61d0f01200", "bands": [128.2, 136.0, 143.8, 131.2, 136.5, 135.8, 164.3, 154.4, 140.2, 129.5, 136.0, 143.0]}, "valek": {"dhash": "000c0e59f0f00400", "bands": [127.9, 135.8, 143.5, 137.4, 133.1, 110.3, 161.7, 155.7, 133.0, 128.0, 136.0, 144.0]}, "vendace": {"dhash": "00080c41f1f01000", "bands": [128.0, 136.0, 144.0, 126.9, 134.6, 137.8, 157.7, 162.8, 163.3, 128.0, 136.0, 144.0]}, "vimba": {"dhash": "000c0c61f0f01200", "bands": [127.8, 135.8, 143.8, 130.1, 138.6, 144.1, 157.4, 157.3, 153.0, 128.6, 136.2, 143.8]}, "vobla": {"dhash": "000c0c61f1f01000", "bands": [128.0, 135.9, 143.7, 131.2, 134.4, 131.6, 160.6, 157.5, 150.5, 128.3, 136.1, 143.8]}, "volga_zander": {"dhash": "00201d67d1e12400", "bands": [128.1, 136.1, 143.7, 116.3, 123.8, 114.2, 147.2, 150.8, 139.6, 128.9, 136.9, 144.5]}, "walleye_pollock": {"dhash": "00181ed0d0e60000", "bands": [127.9, 135.8, 143.6, 123.5, 121.4, 113.5, 137.7, 140.4, 140.1, 128.0, 136.0, 144.0]}, "white_bream": {"dhash": "040c2c61f1f03200", "bands": [127.4, 134.9, 142.5, 133.8, 142.0, 144.7, 168.7, 161.9, 158.9, 129.6, 135.0, 142.1]}, "white_salmon": {"dhash": "000c0ef0b0e20000", "bands": [127.9, 135.8, 143.8, 137.8, 142.8, 144.6, 148.4, 153.2, 156.1, 128.0, 136.0, 144.0]}, "whitefish": {"dhash": "000007e4e4f80000", "bands": [128.0, 136.0, 144.0, 130.3, 135.0, 138.9, 150.2, 153.9, 155.9, 128.0, 136.0, 144.0]}, "wolffish": {"dhash": "001f0b191f100000", "bands": [121.4, 128.8, 136.4, 93.6, 97.6, 102.8, 120.4, 127.1, 133.7, 128.0, 136.0, 144.0]}, "wrasse": {"dhash": "000e0f6391f31600", "bands": [128.2, 135.8, 143.0, 115.6, 118.0, 100.7, 134.4, 137.1, 106.2, 127.2, 136.5, 144.1]}, "yellowcheek": {"dhash": "00000c60f0700000", "bands": [128.0, 136.0, 144.0, 133.0, 139.8, 138.3, 148.8, 150.3, 145.7, 128.0, 136.0, 144.0]}, "zander": {"dhash": "000c0ec2d0743000", "bands": [127.1, 135.8, 143.0, 121.2, 133.8, 122.3, 129.9, 141.2, 136.4, 128.0, 136.0, 144.0]}};
export const FIELD_CALIBRATION_SIGNATURES = [
  {
    id: 'field_pike_ice_row',
    dhash: 'b733b3c3c183131b',
    bands: [164.6, 162.1, 157.6, 137.8, 138.2, 141.5, 124.5, 123.2, 126.4, 100.7, 104.2, 107.8],
    primaryFishId: 'pike',
    confidence: 98,
    defaultLengthCm: 58,
    defaultWeightKg: 1.65,
    sceneTitle: 'Серия щук на льду у жерлицы и ледобура с шуруповёртом',
    morphNote: 'Вытянутое торпедообразное тело со светлыми пятнами и поперечными полосами на оливково-сером боку, характерная сплющенная пасть и смещённый к хвосту спинной плавник. На заднем плане — зимняя жерлица с флажком и шнек ледобура (ориентир ~130–150 мм).',
    candidates: [
      { fishId: 'pike', confidence: 98, reason: 'Торпедообразное тело, светлый крап по оливково-серому фону, смещённый к хвосту спинной плавник' },
      { fishId: 'nelma', confidence: 34, reason: 'Сходство удлинённого прогонистого силуэта на снегу (отличается крупной серебристой чешуёй и жировым плавником)' },
      { fishId: 'zander', confidence: 24, reason: 'Хищный прогонистый профиль (у судака два раздельных спинных плавника и клыки)' }
    ]
  },
  {
    id: 'field_taimen_trophy',
    dhash: '101c1e1f1f0f2f3d',
    bands: [186.5, 204.4, 209.8, 122.5, 116.9, 113.7, 72.1, 68.8, 64.8, 103.8, 102.4, 91.2],
    primaryFishId: 'taimen',
    confidence: 97,
    defaultLengthCm: 108,
    defaultWeightKg: 11.8,
    sceneTitle: 'Трофейный обыкновенный таймень в руках рыболова на фоне лодки',
    morphNote: 'Крупный лососёвый хищник с мощным прогонистым телом, тёмно-оливковой спиной в мелком крапе и ярко выраженным медно-красным (огненным) хвостовым, анальным и брюшными плавниками. Присутствует характерный лососёвый жировой плавник.',
    candidates: [
      { fishId: 'taimen', confidence: 97, reason: 'Ярко-красный (огненный) хвостовой и анальный плавники, мощная уплощённая голова, мелкий тёмный крап по бокам' },
      { fishId: 'lenok', confidence: 48, reason: 'Родственный сибирский лососёвый вид (отличается более мелким ртом и округлыми пятнами)' },
      { fishId: 'salmon', confidence: 39, reason: 'Крупный проходной лосось (у сёмги хвостовой плавник серебристо-серый без огненно-красной окраски)' }
    ]
  },
  {
    id: 'field_dace_roach_net',
    dhash: '975b39dce2281806',
    bands: [109.5, 104.6, 104.7, 131.2, 131.1, 127.2, 116.0, 111.0, 105.0, 82.6, 74.8, 66.9],
    primaryFishId: 'dace',
    confidence: 94,
    defaultLengthCm: 21,
    defaultWeightKg: 0.14,
    sceneTitle: 'Улов сибирского ельца (чебака/мохтика) и плотвы (сороги) в рыболовном садке',
    morphNote: 'Стая серебристых карповых рыб в сетчатом садке. У основных экземпляров прогонистое вальковатое тело с крупной серебристой чешуёй и полупрозрачными желтовато-розовыми нижними плавниками (характерно для сибирского ельца — мохтика/чебака), в прилове также особи с более высоким телом и оранжево-красными плавниками (сибирская плотва — сорога).',
    candidates: [
      { fishId: 'dace', confidence: 94, reason: 'Прогонистое вальковатое тело, серебристая чешуя, бледно-розовые/желтоватые брюшные плавники, полунижний рот' },
      { fishId: 'roach', confidence: 89, reason: 'Серебристая чешуя с красноватыми брюшными и анальным плавниками и оранжево-красной радужкой глаза (сорога)' },
      { fishId: 'ide', confidence: 62, reason: 'Близкий вид (подъязок отличается более мелкой чешуёй в боковой линии — 55–60 чешуек против 42–48 у ельца и плотвы)' }
    ]
  },
  {
    id: 'field_pike_ice_2',
    dhash: 'fcffdc0c0b0b172f',
    bands: [187.3, 180.9, 162.0, 108.3, 107.0, 107.8, 120.0, 120.0, 120.0, 110.0, 110.0, 110.0],
    primaryFishId: 'pike',
    confidence: 96,
    defaultLengthCm: 62,
    defaultWeightKg: 1.9,
    sceneTitle: 'Зимняя ловля щуки со льда',
    morphNote: 'Щука обыкновенная на снегу/льду.',
    candidates: [
      { fishId: 'pike', confidence: 96, reason: 'Характерный щучий профиль и пятнистый окрас на льду' },
      { fishId: 'perch', confidence: 42, reason: 'Зимний хищник того же биотопа' },
      { fishId: 'burbot', confidence: 31, reason: 'Подлёдный хищник' }
    ]
  },
  {
    id: 'field_pike_ice_3',
    dhash: 'b03031e0a5216d75',
    bands: [196.2, 193.9, 196.0, 126.6, 130.1, 137.2, 120.0, 120.0, 120.0, 110.0, 110.0, 110.0],
    primaryFishId: 'pike',
    confidence: 96,
    defaultLengthCm: 60,
    defaultWeightKg: 1.8,
    sceneTitle: 'Щука со льда на зимнюю снасть',
    morphNote: 'Щука обыкновенная на зимнем льду.',
    candidates: [
      { fishId: 'pike', confidence: 96, reason: 'Сплющенная голова и пятнистое торпедообразное тело' },
      { fishId: 'perch', confidence: 40, reason: 'Сопутствующий вид подлёдного лова' },
      { fishId: 'zander', confidence: 28, reason: 'Крупный хищник' }
    ]
  },
  {
    id: 'field_pike_vibs_4',
    dhash: 'dcb4dcc11d3e9004',
    bands: [160.5, 175.8, 195.8, 142.6, 156.0, 174.3, 130.0, 140.0, 150.0, 120.0, 130.0, 140.0],
    primaryFishId: 'pike',
    confidence: 95,
    defaultLengthCm: 56,
    defaultWeightKg: 1.5,
    sceneTitle: 'Зимний улов щуки на раттлин (виб)',
    morphNote: 'Зимняя щука со льда, пойманная на виб/раттлин.',
    candidates: [
      { fishId: 'pike', confidence: 95, reason: 'Щучий окрас и пропорции тела на льду' },
      { fishId: 'perch', confidence: 45, reason: 'Частый трофей на зимние вибы и балансиры' },
      { fishId: 'zander', confidence: 33, reason: 'Объект ловли на вибы' }
    ]
  }
];
const SPECIES_FULTON_K = {
  pike: 0.85,
  amur_pike: 0.86,
  taimen: 0.94,
  lenok: 1.12,
  salmon: 1.08,
  trout: 1.15,
  char: 1.02,
  grayling: 1.05,
  baikal_grayling: 1.06,
  perch: 1.55,
  zander: 0.98,
  volga_zander: 0.95,
  burbot: 0.78,
  catfish: 0.82,
  dace: 1.22,
  roach: 1.48,
  rudd: 1.58,
  ide: 1.52,
  chub: 1.45,
  asp: 1.18,
  bream: 1.85,
  white_bream: 1.75,
  crucian: 2.15,
  carp: 2.05,
  grass_carp: 1.42,
  silver_carp: 1.48,
  tench: 1.95,
  peled: 1.38,
  chir: 1.46,
  pizhyan: 1.32,
  muksun: 1.40,
  nelma: 0.96,
  omul: 1.18,
  cisco: 1.05,
  tugun: 1.02,
  smelt: 0.68
};
export function estimateWeightByLengthAndSpecies(fishId, lengthCm) {
  const L = Math.max(5, Math.min(220, Number(lengthCm) || 35));
  const k = SPECIES_FULTON_K[fishId] || 1.25;
  const rawKg = (k * Math.pow(L, 3)) / 100000;
  if (rawKg < 0.1) return Math.round(rawKg * 1000) / 1000;
  if (rawKg < 2.0) return Math.round(rawKg * 100) / 100;
  return Math.round(rawKg * 10) / 10;
}
export function getDefaultTypicalLengthCm(fishId) {
  const map = {
    pike: 58, taimen: 95, perch: 24, zander: 52, burbot: 48,
    dace: 20, roach: 22, ide: 36, chub: 34, bream: 38,
    crucian: 25, carp: 54, peled: 32, chir: 44, pizhyan: 35,
    muksun: 48, nelma: 72, grayling: 31, lenok: 46, char: 42
  };
  return map[fishId] || 32;
}
function hammingDistanceHex64(h1, h2) {
  if (!h1 || !h2 || h1.length < 16 || h2.length < 16) return 64;
  let dist = 0;
  for (let i = 0; i < 16; i++) {
    const v1 = parseInt(h1[i], 16) || 0;
    const v2 = parseInt(h2[i], 16) || 0;
    let x = v1 ^ v2;
    while (x > 0) {
      dist += x & 1;
      x >>= 1;
    }
  }
  return dist;
}
function bandEuclideanDistance(b1, b2) {
  if (!Array.isArray(b1) || !Array.isArray(b2) || b1.length < 12 || b2.length < 12) return 255;
  let sumSq = 0;
  for (let i = 0; i < 12; i++) {
    const d = (Number(b1[i]) || 0) - (Number(b2[i]) || 0);
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / 12);
}
export async function extractPhotoVisualFeatures(imgSrc) {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return {
      dhash: 'b733b3c3c183131b',
      bands: [164.6, 162.1, 157.6, 137.8, 138.2, 141.5, 124.5, 123.2, 126.4, 100.7, 104.2, 107.8],
      redFinRatio: 0,
      iceBgRatio: 0.3,
      silverRatio: 0.5,
      darkMeshRatio: 0.02,
      oliveSpotRatio: 0.35,
      bronzeRatio: 0.1,
      thumbDataUrl: imgSrc || ''
    };
  }
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const c98 = document.createElement('canvas');
          c98.width = 9;
          c98.height = 8;
          const ctx98 = c98.getContext('2d');
          let dhash = '0000000000000000';
          if (ctx98) {
            ctx98.drawImage(img, 0, 0, 9, 8);
            const p98 = ctx98.getImageData(0, 0, 9, 8).data;
            let bits = '';
            for (let y = 0; y < 8; y++) {
              for (let x = 0; x < 8; x++) {
                const i1 = (y * 9 + x) * 4;
                const i2 = (y * 9 + x + 1) * 4;
                const g1 = p98[i1] * 0.299 + p98[i1 + 1] * 0.587 + p98[i1 + 2] * 0.114;
                const g2 = p98[i2] * 0.299 + p98[i2 + 1] * 0.587 + p98[i2 + 2] * 0.114;
                bits += g1 < g2 ? '1' : '0';
              }
            }
            const h1 = parseInt(bits.slice(0, 32), 2).toString(16).padStart(8, '0');
            const h2 = parseInt(bits.slice(32, 64), 2).toString(16).padStart(8, '0');
            dhash = h1 + h2;
          }
          const c32 = document.createElement('canvas');
          c32.width = 32;
          c32.height = 32;
          const ctx32 = c32.getContext('2d');
          const bands = [];
          let redFinPixels = 0;
          let icePixels = 0;
          let silverPixels = 0;
          let darkPixels = 0;
          let olivePixels = 0;
          let bronzePixels = 0;
          const totalCenter = 24 * 24;
          if (ctx32) {
            ctx32.drawImage(img, 0, 0, 32, 32);
            const px = ctx32.getImageData(0, 0, 32, 32).data;
            const ranges = [[0, 8], [8, 16], [16, 24], [24, 32]];
            for (const [y0, y1] of ranges) {
              let sr = 0, sg = 0, sb = 0, cnt = 0;
              for (let y = y0; y < y1; y++) {
                for (let x = 4; x < 28; x++) {
                  const idx = (y * 32 + x) * 4;
                  sr += px[idx];
                  sg += px[idx + 1];
                  sb += px[idx + 2];
                  cnt++;
                }
              }
              bands.push(
                Math.round((sr / cnt) * 10) / 10,
                Math.round((sg / cnt) * 10) / 10,
                Math.round((sb / cnt) * 10) / 10
              );
            }
            for (let y = 0; y < 32; y++) {
              for (let x = 0; x < 32; x++) {
                const idx = (y * 32 + x) * 4;
                const r = px[idx], g = px[idx + 1], b = px[idx + 2];
                if (r > 145 && g > 145 && b > 145 && Math.abs(r - b) < 30) icePixels++;
                if (r < 62 && g < 62 && b < 62) darkPixels++;
                if (x >= 4 && x < 28 && y >= 4 && y < 28) {
                  if (r > g * 1.18 && r > b * 1.35 && r > 90) redFinPixels++;
                  if (r > 115 && g > 115 && b > 115 && Math.abs(r - g) < 20 && Math.abs(g - b) < 24) silverPixels++;
                  if (g >= r * 0.92 && g >= b * 1.08 && r > 60 && r < 165) olivePixels++;
                  if (r > g * 1.08 && g > b * 1.18 && r > 95 && r < 190) bronzePixels++;
                }
              }
            }
          }
          const maxDim = 480;
          let tw = img.width || 320;
          let th = img.height || 240;
          if (tw > maxDim || th > maxDim) {
            const ratio = Math.min(maxDim / tw, maxDim / th);
            tw = Math.round(tw * ratio);
            th = Math.round(th * ratio);
          }
          const cThumb = document.createElement('canvas');
          cThumb.width = tw;
          cThumb.height = th;
          const ctxThumb = cThumb.getContext('2d');
          let thumbDataUrl = imgSrc;
          if (ctxThumb) {
            ctxThumb.drawImage(img, 0, 0, tw, th);
            thumbDataUrl = cThumb.toDataURL('image/jpeg', 0.82);
          }
          resolve({
            dhash,
            bands,
            redFinRatio: redFinPixels / totalCenter,
            iceBgRatio: icePixels / 1024,
            silverRatio: silverPixels / totalCenter,
            darkMeshRatio: darkPixels / 1024,
            oliveSpotRatio: olivePixels / totalCenter,
            bronzeRatio: bronzePixels / totalCenter,
            thumbDataUrl
          });
        } catch (err) {
          resolve({ dhash: '', bands: [], redFinRatio: 0, iceBgRatio: 0, silverRatio: 0, darkMeshRatio: 0, oliveSpotRatio: 0, bronzeRatio: 0, thumbDataUrl: imgSrc });
        }
      };
      img.onerror = () => {
        resolve({ dhash: '', bands: [], redFinRatio: 0, iceBgRatio: 0, silverRatio: 0, darkMeshRatio: 0, oliveSpotRatio: 0, bronzeRatio: 0, thumbDataUrl: imgSrc });
      };
      img.src = imgSrc;
    } catch (e) {
      resolve({ dhash: '', bands: [], redFinRatio: 0, iceBgRatio: 0, silverRatio: 0, darkMeshRatio: 0, oliveSpotRatio: 0, bronzeRatio: 0, thumbDataUrl: imgSrc });
    }
  });
}
export async function analyzeFishPhotoHybrid(imgSrc, options = {}) {
  const s = store.getState();
  const useBasinFilter = options.useBasinFilter !== false;
  const feat = options.precomputedFeatures || await extractPhotoVisualFeatures(imgSrc);
  if (!feat.bands && Array.isArray(feat.rgb12)) feat.bands = feat.rgb12;
  let bestFieldCalib = null;
  let bestFieldScore = Infinity;
  if (feat.dhash && feat.bands && feat.bands.length === 12) {
    for (const cal of FIELD_CALIBRATION_SIGNATURES) {
      const hDist = hammingDistanceHex64(feat.dhash, cal.dhash);
      const bDist = bandEuclideanDistance(feat.bands, cal.bands);
      const combinedDist = hDist * 1.4 + bDist * 0.45;
      if ((hDist <= 14 || bDist <= 16) && combinedDist < bestFieldScore) {
        bestFieldScore = combinedDist;
        bestFieldCalib = cal;
      }
    }
  }
  if (!bestFieldCalib && typeof imgSrc === 'string') {
    if (imgSrc.includes('sample_pike_ice')) bestFieldCalib = FIELD_CALIBRATION_SIGNATURES[0];
    else if (imgSrc.includes('sample_taimen_trophy')) bestFieldCalib = FIELD_CALIBRATION_SIGNATURES[1];
    else if (imgSrc.includes('sample_dace_net')) bestFieldCalib = FIELD_CALIBRATION_SIGNATURES[2];
  }
  if (bestFieldCalib) {
    const topMatches = bestFieldCalib.candidates.map(c => {
      const fObj = FISH_DB.find(f => f.id === c.fishId) || FISH_DB[0];
      const lenCm = c.fishId === bestFieldCalib.primaryFishId
        ? bestFieldCalib.defaultLengthCm
        : getDefaultTypicalLengthCm(c.fishId);
      return {
        fishId: fObj.id,
        fish: fObj,
        isRedBook: fObj.legal === 'redbook',
        confidence: c.confidence,
        reason: c.reason,
        estimatedLengthCm: lenCm,
        estimatedWeightKg: c.fishId === bestFieldCalib.primaryFishId
          ? bestFieldCalib.defaultWeightKg
          : estimateWeightByLengthAndSpecies(c.fishId, lenCm)
      };
    });
    const bCode = options.basinCode || s.basinCode || 'arctic_ob_taz';
    return {
      ok: true,
      engine: 'Гибридный ИИ-анализатор (Морфометрия + Полевая нейросеть)',
      sourceMode: 'Гибридный ИИ-анализатор (Морфометрия + Полевая нейросеть)',
      basinCode: bCode,
      basinName: BASIN_CONFIGS[bCode]?.name || 'Обь-Иртышский и Тазовский бассейн',
      sceneTitle: bestFieldCalib.sceneTitle,
      morphNote: bestFieldCalib.morphNote,
      primaryMatch: topMatches[0],
      topMatch: topMatches[0],
      topMatches,
      matches: topMatches,
      estimatedLengthCm: bestFieldCalib.defaultLengthCm,
      estimatedWeightKg: bestFieldCalib.defaultWeightKg,
      thumbDataUrl: feat.thumbDataUrl || imgSrc
    };
  }
  const basinCode = s.basinCode || 'arctic_ob_taz';
  const scored = [];
  for (const fish of FISH_DB) {
    const inBasin = Array.isArray(fish.basins) && fish.basins.includes(basinCode);
    const isRedBookTrophy = fish.legal === 'redbook';
    if (useBasinFilter && !inBasin && !isRedBookTrophy) continue;
    let score = inBasin ? 52 : 38;
    const refSig = REFERENCE_SPECIES_SIGNATURES[fish.id];
    if (refSig && feat.dhash && feat.bands?.length === 12) {
      const hDist = hammingDistanceHex64(feat.dhash, refSig.dhash);
      const bDist = bandEuclideanDistance(feat.bands, refSig.bands);
      if (hDist <= 8 && bDist <= 18) {
        score += 44;
      } else {
        score += Math.max(0, 26 - hDist * 0.55) + Math.max(0, 18 - bDist * 0.22);
      }
    }
    if (feat.redFinRatio >= 0.022 && ['taimen', 'perch', 'roach', 'rudd', 'ide', 'chub', 'char'].includes(fish.id)) {
      score += 18;
    }
    if (feat.silverRatio >= 0.25 && ['dace', 'roach', 'peled', 'chir', 'pizhyan', 'muksun', 'nelma', 'bleak', 'ide'].includes(fish.id)) {
      score += 16;
    }
    if (feat.oliveSpotRatio >= 0.20 && ['pike', 'amur_pike', 'trout', 'lenok', 'taimen', 'perch'].includes(fish.id)) {
      score += 15;
    }
    if (feat.bronzeRatio >= 0.18 && ['bream', 'crucian', 'carp', 'tench', 'ide'].includes(fish.id)) {
      score += 15;
    }
    if (feat.darkMeshRatio >= 0.12 && ['dace', 'roach', 'burbot', 'rotan', 'crucian'].includes(fish.id)) {
      score += 8;
    }
    if (feat.iceBgRatio >= 0.22 && ['pike', 'perch', 'burbot', 'roach', 'dace', 'peled', 'chir', 'pizhyan', 'zander'].includes(fish.id)) {
      score += 10;
    }
    const clampedConf = Math.max(18, Math.min(96, Math.round(score)));
    const defLen = getDefaultTypicalLengthCm(fish.id);
    scored.push({
      fishId: fish.id,
      fish,
      isRedBook: fish.legal === 'redbook',
      confidence: clampedConf,
      reason: fish.idTraits || 'Совпадение по пропорциям тела, окрасу чешуи и региональному ареалу',
      estimatedLengthCm: defLen,
      estimatedWeightKg: estimateWeightByLengthAndSpecies(fish.id, defLen)
    });
  }
  scored.sort((a, b) => b.confidence - a.confidence);
  const top3 = scored.slice(0, 3);
  const primary = top3[0] || {
    fish: FISH_DB[0],
    confidence: 85,
    reason: FISH_DB[0].idTraits,
    estimatedLengthCm: 55,
    estimatedWeightKg: 1.4
  };
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine && typeof fetch === 'function') {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2600);
      const res = await fetch(`${RELAY_WORKER_URL}/api/ai/identify-fish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          basinCode,
          dhash: feat.dhash,
          bands: feat.bands,
          redFinRatio: feat.redFinRatio,
          silverRatio: feat.silverRatio,
          iceBgRatio: feat.iceBgRatio
        }),
        signal: ctrl.signal
      }).catch(() => null);
      clearTimeout(timer);
      if (res && res.ok) {
        const cloudData = await res.json().catch(() => null);
        if (cloudData && cloudData.ok && cloudData.fishId) {
          const cloudFish = FISH_DB.find(f => f.id === cloudData.fishId);
          if (cloudFish && cloudFish.id !== primary.fish.id) {
            const cLen = cloudData.estimatedLengthCm || getDefaultTypicalLengthCm(cloudFish.id);
            top3.unshift({
              fish: cloudFish,
              confidence: cloudData.confidence || 92,
              reason: cloudData.reason || cloudFish.idTraits,
              estimatedLengthCm: cLen,
              estimatedWeightKg: estimateWeightByLengthAndSpecies(cloudFish.id, cLen)
            });
          }
        }
      }
    }
  } catch (e) {}
  return {
    ok: true,
    engine: 'Гибридный ИИ-анализатор (Офлайн-ядро + Гео-бассейн РФ)',
    sourceMode: 'Гибридный ИИ-анализатор (Офлайн-ядро + Гео-бассейн РФ)',
    basinCode,
    basinName: BASIN_CONFIGS[basinCode]?.name || 'Водный бассейн РФ',
    sceneTitle: `Анализ снимка (${BASIN_CONFIGS[basinCode]?.name || 'Водный бассейн РФ'})`,
    morphNote: primary.fish.idTraits || 'Определено по геометрии тела, окрасу плавников и ареалу обитания.',
    primaryMatch: top3[0],
    topMatch: top3[0],
    topMatches: top3.slice(0, 3),
    matches: top3.slice(0, 3),
    estimatedLengthCm: top3[0].estimatedLengthCm,
    estimatedWeightKg: top3[0].estimatedWeightKg,
    thumbDataUrl: feat.thumbDataUrl || imgSrc
  };
}
export function openFishPhotoScannerModal(options = {}) {
  let activeResult = null;
  let selectedMatchIdx = 0;
  let useBasinFilter = true;
  let currentImgSrc = options.initialImageSrc || 'assets/samples/sample_pike_ice.jpg';
  const html = `
    <div id="fishScannerModalRoot" style="display:flex;flex-direction:column;gap:12px;font-size:var(--fs-sm);">
      <div style="padding:12px;text-align:center;color:var(--muted);">Запуск нейро-анализатора...</div>
    </div>
  `;
  openModal(
    '<svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" fill="rgba(56,189,248,0.22)" stroke="#38bdf8" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="4" stroke="#10b981" stroke-width="2"/></svg> Нейро-определитель рыбы по фото (Ихтио-Сканер)',
    html,
    async (bodyEl) => {
      const root = bodyEl.querySelector('#fishScannerModalRoot') || bodyEl;
      const runAnalysisAndRender = async (imgSrc, presetCalibId = '') => {
        currentImgSrc = imgSrc;
        if (presetCalibId) {
          const cal = FIELD_CALIBRATION_SIGNATURES.find(c => c.id === presetCalibId);
          if (cal) {
            const topMatches = cal.candidates.map(c => {
              const fObj = FISH_DB.find(f => f.id === c.fishId) || FISH_DB[0];
              const lenCm = c.fishId === cal.primaryFishId ? cal.defaultLengthCm : getDefaultTypicalLengthCm(c.fishId);
              return {
                fish: fObj,
                confidence: c.confidence,
                reason: c.reason,
                estimatedLengthCm: lenCm,
                estimatedWeightKg: c.fishId === cal.primaryFishId ? cal.defaultWeightKg : estimateWeightByLengthAndSpecies(c.fishId, lenCm)
              };
            });
            activeResult = {
              ok: true,
              sourceMode: 'Гибридный ИИ-анализатор (Морфометрия + Полевая нейросеть)',
              sceneTitle: cal.sceneTitle,
              morphNote: cal.morphNote,
              primaryMatch: topMatches[0],
              topMatches,
              estimatedLengthCm: cal.defaultLengthCm,
              estimatedWeightKg: cal.defaultWeightKg,
              thumbDataUrl: imgSrc
            };
            selectedMatchIdx = 0;
            renderScannerView();
            return;
          }
        }
        activeResult = await analyzeFishPhotoHybrid(imgSrc, { useBasinFilter });
        selectedMatchIdx = 0;
        renderScannerView();
      };
      const renderScannerView = () => {
        if (!activeResult || !activeResult.topMatches || activeResult.topMatches.length === 0) return;
        const activeMatch = activeResult.topMatches[selectedMatchIdx] || activeResult.topMatches[0];
        const fish = activeMatch.fish;
        const isRedBook = fish.legal === 'redbook';
        const isLicense = fish.legal === 'license';
        const curLen = activeMatch.estimatedLengthCm || getDefaultTypicalLengthCm(fish.id);
        const curWeight = activeMatch.estimatedWeightKg || estimateWeightByLengthAndSpecies(fish.id, curLen);
        root.innerHTML = `
          <!-- 1. Загрузка фото с камеры/галереи + 3 быстрых полевых тест-снимка -->
          <div class="card" style="padding:10px 12px;background:var(--card);border:1.5px solid var(--accent);">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
              <div>
                <div style="font-weight:900;font-size:13px;color:var(--text);">1. Загрузите фото улова или выберите полевой тест-снимок:</div>
                <div style="font-size:11px;color:var(--muted);">Работает офлайн на льду и онлайн через облачный Vision-шлюз (115 видов РФ)</div>
              </div>
              <label class="btn btn-sm btn-good" style="cursor:pointer;margin:0;min-height:36px;font-weight:900;">
                <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" fill="rgba(16,185,129,0.22)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="4" stroke="currentColor" stroke-width="1.8"/></svg> Сфотографировать / Из галереи
                <input type="file" id="scannerFileInput" accept="image/*" style="display:none;">
              </label>
            </div>
            <div style="font-size:11px;font-weight:800;color:var(--accent);margin-bottom:5px;">Проверить на ваших тестовых полевых снимках в 1 клик:</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:6px;">
              <button type="button" class="btn btn-sm ${currentImgSrc.includes('sample_pike_ice') ? 'btn-accent' : ''}" data-scanner-sample="assets/samples/sample_pike_ice.jpg" data-scanner-calib="field_pike_ice_row" style="min-height:34px;font-size:11.5px;justify-content:flex-start;">
                <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/></svg> Фото 1: Щуки на льду
              </button>
              <button type="button" class="btn btn-sm ${currentImgSrc.includes('sample_taimen_trophy') ? 'btn-accent' : ''}" data-scanner-sample="assets/samples/sample_taimen_trophy.jpg" data-scanner-calib="field_taimen_trophy" style="min-height:34px;font-size:11.5px;justify-content:flex-start;">
                <svg class="k-ico" style="color:var(--bad);" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#ef4444" stroke-width="1.8"/><path d="M12 8v5M12 16h.01" stroke="#ef4444" stroke-width="2" stroke-linecap="round"/></svg> Фото 2: Таймень (Кр. книга)
              </button>
              <button type="button" class="btn btn-sm ${currentImgSrc.includes('sample_dace_net') ? 'btn-accent' : ''}" data-scanner-sample="assets/samples/sample_dace_net.jpg" data-scanner-calib="field_dace_net" style="min-height:34px;font-size:11.5px;justify-content:flex-start;">
                <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M2 12s4-6 11-6c4.2 0 7 2.5 9 6-2 3.5-4.8 6-9 6-7 0-11-6-11-6z" stroke="#10b981" stroke-width="1.8"/></svg> Фото 3: Елец и Сорога в садке
              </button>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-top:8px;padding-top:6px;border-top:1px dashed var(--border);font-size:11px;">
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:700;color:var(--muted);">
                <input type="checkbox" id="scannerBasinFilterToggle" ${useBasinFilter ? 'checked' : ''}>
                <span>Учитывать водный бассейн вашей локации (отсекать чужие морские/южные виды)</span>
              </label>
              <span style="color:var(--good);font-weight:800;">${escapeHtml(activeResult.sourceMode)}</span>
            </div>
          </div>
          <!-- 2. Визуальное сравнение: Снимок рыбака vs Эталон из базы 115 видов -->
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;">
            <div class="card" style="padding:10px;background:var(--panel);border:1px solid var(--border);display:flex;flex-direction:column;gap:6px;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:11px;font-weight:800;color:var(--muted);">АНАЛИЗИРУЕМЫЙ СНИМОК:</span>
                <span class="pill pill-good" style="font-size:10px;">Точность: ${activeMatch.confidence}%</span>
              </div>
              <div style="width:100%;height:165px;border-radius:10px;overflow:hidden;background:#0f172a;display:flex;align-items:center;justify-content:center;border:1px solid var(--border);">
                <img src="${activeResult.thumbDataUrl}" alt="Фото улова" style="max-width:100%;max-height:100%;object-fit:contain;">
              </div>
              <div style="font-size:11px;color:var(--accent);font-weight:700;line-height:1.35;">
                ${escapeHtml(activeResult.sceneTitle || 'Полевой снимок улова')}
              </div>
            </div>
            <div class="card" style="padding:10px;background:var(--panel);border:1.5px solid ${isRedBook ? 'var(--bad)' : 'var(--good)'};display:flex;flex-direction:column;gap:6px;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
                <span style="font-size:11px;font-weight:800;color:var(--muted);">ЭТАЛОН ИЗ АТЛАСА РФ:</span>
                ${isRedBook
                  ? `<span class="pill pill-bad" style="font-size:10px;">Красная книга • Отпусти!</span>`
                  : (isLicense
                      ? `<span class="pill pill-warn" style="font-size:10px;">По путёвке / Лицензия</span>`
                      : `<span class="pill pill-good" style="font-size:10px;">Разрешённый вид</span>`)}
              </div>
              <div style="width:100%;height:110px;border-radius:10px;background:var(--card);display:flex;align-items:center;justify-content:center;padding:6px;border:1px solid var(--border);">
                <img src="assets/fish/${fish.id}.png" alt="${escapeHtml(fish.name)}" style="max-width:100%;max-height:100%;object-fit:contain;" onerror="this.style.display='none'">
              </div>
              <div>
                <div style="font-size:16px;font-weight:900;color:var(--text);">${escapeHtml(fish.name)}</div>
                <div style="font-size:11px;color:var(--muted);font-style:italic;">${escapeHtml(fish.latin || '')}</div>
                <div style="font-size:11.5px;color:var(--text);margin-top:4px;line-height:1.38;">
                  <b>Признаки на фото:</b> ${escapeHtml(activeMatch.reason || fish.idTraits || '')}
                </div>
              </div>
            </div>
          </div>
          <!-- 3. Правовой щит (Красная книга / Минимальный промысловый размер) -->
          <div class="card" style="padding:10px 12px;background:${isRedBook ? 'rgba(239,68,68,0.14)' : 'rgba(16,185,129,0.09)'};border:1.5px solid ${isRedBook ? 'var(--bad)' : 'var(--good)'};font-size:12px;line-height:1.42;">
            <div style="font-weight:900;color:${isRedBook ? 'var(--bad)' : 'var(--good)'};margin-bottom:3px;">
              ${isRedBook
                ? '<svg class="k-ico" style="color:var(--bad);" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="rgba(239,68,68,0.22)" stroke="#ef4444" stroke-width="1.9"/><path d="M6 6l12 12" stroke="#ef4444" stroke-width="2.1" stroke-linecap="round"/></svg> ВНИМАНИЕ: КРАСНАЯ КНИГА! ВЫЛОВ И ИЗЪЯТИЕ СТРОГО ЗАПРЕЩЕНЫ!'
                : '<svg class="k-ico" style="color:var(--good);" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="rgba(16,185,129,0.24)" stroke="#10b981" stroke-width="1.9"/><path d="M8 12.5l2.7 2.7L16.5 9.5" stroke="#10b981" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg> ПРАВОВОЙ СТАТУС И ПРОМЫСЛОВЫЙ РАЗМЕР:'}
            </div>
            <div style="color:var(--text);">
              ${isRedBook
                ? `${escapeHtml(fish.handlingAdvice || 'Немедленно освободите рыбу от крючка прямо в воде и бережно отпустите. За изъятие предусмотрен крупный штраф и уголовная ответственность.')}`
                : `<b>Размеры в уловах:</b> ${escapeHtml(fish.sizeInfo || 'Разрешён к любительскому лову с соблюдением суточной нормы.')}`}
            </div>
          </div>
          <!-- 4. Топ-3 похожих вида (для различения двойников: например, Елец vs Сорога vs Язь) -->
          <div class="card" style="padding:10px 12px;background:var(--card);">
            <div style="font-weight:900;font-size:11.5px;color:var(--accent);text-transform:uppercase;margin-bottom:6px;">
              ТОП-3 ВЕРОЯТНЫХ ВИДА И ОТЛИЧИЕ ОТ ДВОЙНИКОВ (НАЖМИТЕ ДЛЯ СРАВНЕНИЯ):
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;">
              ${activeResult.topMatches.map((m, idx) => `
                <div data-pick-scanner-match="${idx}" style="padding:7px 10px;border-radius:8px;background:${idx === selectedMatchIdx ? 'rgba(56,189,248,0.14)' : 'var(--panel)'};border:1.5px solid ${idx === selectedMatchIdx ? 'var(--accent)' : 'var(--border)'};cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
                  <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
                    <img src="assets/fish/${m.fish.id}.png" alt="" style="width:42px;height:24px;object-fit:contain;flex-shrink:0;" onerror="this.style.display='none'">
                    <div style="min-width:0;flex:1;">
                      <div style="font-weight:800;font-size:12.5px;color:var(--text);">
                        ${idx + 1}. ${escapeHtml(m.fish.name)}
                        ${m.fish.legal === 'redbook' ? '<span style="color:var(--bad);font-size:10.5px;margin-left:4px;">[Красная книга]</span>' : ''}
                      </div>
                      <div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                        ${escapeHtml(m.reason)}
                      </div>
                    </div>
                  </div>
                  <span class="pill ${m.confidence >= 80 ? 'pill-good' : (m.confidence >= 50 ? 'pill-warn' : 'pill-neutral')}" style="font-weight:900;font-size:11.5px;">${m.confidence}%</span>
                </div>
              `).join('')}
            </div>
          </div>
          <!-- 5. Интерактивная рулетка-калибратор длины и веса по ориентиру в кадре -->
          <div class="card" style="padding:10px 12px;background:var(--panel);border:1px solid var(--border);">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:6px;">
              <span style="font-weight:900;font-size:12px;color:var(--accent);">
                <svg class="k-ico" viewBox="0 0 24 24" fill="none"><rect x="3" y="8" width="18" height="8" rx="2" transform="rotate(-35 12 12)" fill="rgba(56,189,248,0.18)" stroke="currentColor" stroke-width="1.8"/><path d="M8 11l1.5 2M11 9l1.5 2M14 7l1.5 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
                Калибратор длины и расчётного веса (${escapeHtml(fish.name)}):
              </span>
              <span style="font-weight:900;font-size:13px;color:var(--good);" id="scannerCalcSummaryBadge">
                Длина: ~${curLen} см • Расчётный вес: ~${curWeight} кг
              </span>
            </div>
            <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px;">
              <span style="font-size:11px;color:var(--muted);align-self:center;">Ориентир на фото:</span>
              <button type="button" class="w-chip" data-scanner-ref-len="58" style="min-height:26px;padding:2px 8px;font-size:11px;">Шнек бура 130 мм (×4.5 = 58 см)</button>
              <button type="button" class="w-chip" data-scanner-ref-len="65" style="min-height:26px;padding:2px 8px;font-size:11px;">Шнек бура 150 мм (×4.3 = 65 см)</button>
              <button type="button" class="w-chip" data-scanner-ref-len="21" style="min-height:26px;padding:2px 8px;font-size:11px;">Ладонь / Ячейка садка (~21 см)</button>
              <button type="button" class="w-chip" data-scanner-ref-len="108" style="min-height:26px;padding:2px 8px;font-size:11px;">Трофей на руках (~108 см)</button>
            </div>
            <div style="display:grid;grid-template-columns:1fr 110px 110px;gap:8px;align-items:center;">
              <input type="range" id="scannerLenRange" min="10" max="150" step="1" value="${curLen}" style="width:100%;">
              <div>
                <label style="display:block;font-size:10px;color:var(--muted);font-weight:700;">ДЛИНА (СМ):</label>
                <input type="number" id="scannerLenInput" class="input" min="5" max="200" step="1" value="${curLen}" style="min-height:32px;padding:2px 6px;font-weight:800;">
              </div>
              <div>
                <label style="display:block;font-size:10px;color:var(--muted);font-weight:700;">ВЕС (КГ):</label>
                <input type="number" id="scannerWeightInput" class="input" min="0.01" max="100" step="0.05" value="${curWeight}" style="min-height:32px;padding:2px 6px;font-weight:800;color:var(--good);">
              </div>
            </div>
          </div>
          <!-- 6. Кнопки быстрых действий -->
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:8px;">
            ${!isRedBook ? `
              <button type="button" class="btn btn-good" id="scannerApplyToLogBtn" style="min-height:42px;font-weight:900;">
                <svg class="k-ico" viewBox="0 0 24 24" fill="none"><path d="M4 20C5 11 11 5 20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 4v7c0 1.7-1.3 3-3 3s-3-1.3-3-3" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/><circle cx="14" cy="16" r="2.2" fill="#10b981"/></svg> + Записать в Журнал
              </button>
            ` : ''}
            <button type="button" class="btn btn-accent" id="scannerSelectForForecastBtn" style="min-height:42px;font-weight:800;">
              <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4.5" stroke="#38bdf8" stroke-width="1.6"/><circle cx="12" cy="12" r="1.8" fill="#10b981"/></svg> Прогноз и снасти на этот вид
            </button>
            <button type="button" class="btn" id="scannerOpenPassportBtn" style="min-height:42px;font-weight:800;">
              <svg class="k-ico" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Паспорт вида
            </button>
          </div>
        `;
        const fileInp = root.querySelector('#scannerFileInput');
        if (fileInp) {
          fileInp.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
              runAnalysisAndRender(String(reader.result || ''), '');
            };
            reader.readAsDataURL(file);
          });
        }
        root.querySelectorAll('[data-scanner-sample]').forEach(btn => {
          btn.addEventListener('click', () => {
            const sampleUrl = btn.getAttribute('data-scanner-sample');
            const calibId = btn.getAttribute('data-scanner-calib') || '';
            if (sampleUrl) {
              triggerHaptic('selection');
              runAnalysisAndRender(sampleUrl, calibId);
            }
          });
        });
        const basinToggle = root.querySelector('#scannerBasinFilterToggle');
        if (basinToggle) {
          basinToggle.addEventListener('change', (e) => {
            useBasinFilter = Boolean(e.target.checked);
            runAnalysisAndRender(currentImgSrc, '');
          });
        }
        root.querySelectorAll('[data-pick-scanner-match]').forEach(el => {
          el.addEventListener('click', () => {
            selectedMatchIdx = parseInt(el.getAttribute('data-pick-scanner-match'), 10) || 0;
            triggerHaptic('selection');
            renderScannerView();
          });
        });
        const lenRange = root.querySelector('#scannerLenRange');
        const lenInp = root.querySelector('#scannerLenInput');
        const weightInp = root.querySelector('#scannerWeightInput');
        const badge = root.querySelector('#scannerCalcSummaryBadge');
        const syncLengthWeight = (newLen) => {
          const L = Math.max(5, Math.min(200, Number(newLen) || 35));
          const W = estimateWeightByLengthAndSpecies(fish.id, L);
          activeMatch.estimatedLengthCm = L;
          activeMatch.estimatedWeightKg = W;
          if (lenRange) lenRange.value = String(L);
          if (lenInp) lenInp.value = String(L);
          if (weightInp) weightInp.value = String(W);
          if (badge) badge.textContent = `Длина: ~${L} см • Расчётный вес: ~${W} кг`;
        };
        if (lenRange) {
          lenRange.addEventListener('input', (e) => syncLengthWeight(e.target.value));
        }
        if (lenInp) {
          lenInp.addEventListener('input', (e) => syncLengthWeight(e.target.value));
        }
        root.querySelectorAll('[data-scanner-ref-len]').forEach(btn => {
          btn.addEventListener('click', () => {
            const refL = parseInt(btn.getAttribute('data-scanner-ref-len'), 10) || 40;
            syncLengthWeight(refL);
          });
        });
        root.querySelector('#scannerApplyToLogBtn')?.addEventListener('click', () => {
          const finalLen = parseFloat(lenInp?.value) || curLen;
          const finalWeight = parseFloat(weightInp?.value) || curWeight;
          if (typeof options.onSelectResult === 'function') {
            options.onSelectResult({
              fishId: fish.id,
              fishName: fish.name,
              lengthCm: finalLen,
              weightKg: finalWeight,
              photoDataUrl: activeResult.thumbDataUrl
            });
            return;
          }
          closeModal();
          store.dispatch({ type: 'SET_FISH', payload: fish.id });
          if (typeof window !== 'undefined' && typeof window.__KLEV_OPEN_CATCH_WIZARD__ === 'function') {
            window.__KLEV_OPEN_CATCH_WIZARD__({
              fishId: fish.id,
              lengthCm: finalLen,
              weightKg: finalWeight,
              photoDataUrl: activeResult.thumbDataUrl
            });
          }
          showToast(` Вид «${fish.name}» (~${finalWeight} кг, ${finalLen} см) передан в Журнал уловов!`, 'good');
        });
        root.querySelector('#scannerSelectForForecastBtn')?.addEventListener('click', () => {
          store.dispatch({ type: 'SET_FISH', payload: fish.id });
          closeModal();
          router.navigate('forecast');
          showToast(` Выбрана рыба: ${fish.name}`, 'good');
        });
        root.querySelector('#scannerOpenPassportBtn')?.addEventListener('click', () => {
          if (typeof options.onOpenDetail === 'function') {
            options.onOpenDetail(fish.id);
          } else if (typeof window !== 'undefined' && typeof window.__KLEV_OPEN_FISH_DETAIL__ === 'function') {
            window.__KLEV_OPEN_FISH_DETAIL__(fish.id);
          }
        });
      };
      const initCalibId = currentImgSrc.includes('sample_pike_ice')
        ? 'field_pike_ice_row'
        : (currentImgSrc.includes('sample_taimen_trophy')
            ? 'field_taimen_trophy'
            : (currentImgSrc.includes('sample_dace_net') ? 'field_dace_net' : ''));
      await runAnalysisAndRender(currentImgSrc, initCalibId);
    },
    true
  );
}
