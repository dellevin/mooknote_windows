import {
  faTv,
  faFilm,
  faClapperboard,
  faMasksTheater,
  faVideo,
  faTicket,
  faHeadphones,
  faPodcast,
  faMusic,
  faRadio,
  faMicrophone,
  faGuitar,
  faDrum,
  faBook,
  faBookOpen,
  faNewspaper,
  faPen,
  faGamepad,
  faChess,
  faPuzzlePiece,
  faDice,
  faGhost,
  faRobot,
  faTrophy,
  faMedal,
  faDumbbell,
  faFutbol,
  faPersonRunning,
  faPalette,
  faCamera,
  faCameraRetro,
  faImage,
  faImages,
  faPlane,
  faCar,
  faBicycle,
  faRocket,
  faLocationDot,
  faCompass,
  faGlobe,
  faMap,
  faMountain,
  faTree,
  faLeaf,
  faSun,
  faMoon,
  faCloud,
  faSnowflake,
  faFire,
  faBolt,
  faUmbrella,
  faPaw,
  faCat,
  faDog,
  faFish,
  faMugHot,
  faMugSaucer,
  faUtensils,
  faPizzaSlice,
  faBurger,
  faAppleWhole,
  faCakeCandles,
  faWineGlass,
  faBeerMugEmpty,
  faHouse,
  faCouch,
  faBed,
  faShirt,
  faGift,
  faCartShopping,
  faBriefcase,
  faGraduationCap,
  faBaby,
  faChild,
  faPerson,
  faLaptop,
  faMobileScreen,
  faKeyboard,
  faHeadset,
  faNoteSticky,
  faEnvelope,
  faComment,
  faBell,
  faCalendar,
  faClock,
  faBinoculars,
  faGlasses,
  faLightbulb,
  faMagnet,
  faKey,
  faShieldHalved,
  faStar,
  faHeart,
  faBookmark,
  faFlag,
  faTag,
  faFolder,
  faBox,
  faCrown,
  faGem,
  faWandSparkles,
  faHatWizard,
  faMask,
  faFaceSmile,
  faThumbsUp,
  type IconDefinition
} from '@fortawesome/free-solid-svg-icons'

// 与手机端 kCustomModuleIcons 一致（FontAwesome free-solid），按分组排列
export const CUSTOM_MODULE_ICONS: IconDefinition[] = [
  // 影音阅读
  faTv, faFilm, faClapperboard, faMasksTheater, faVideo, faTicket,
  faHeadphones, faPodcast, faMusic, faRadio, faMicrophone, faGuitar, faDrum,
  faBook, faBookOpen, faNewspaper, faPen,
  // 游戏娱乐
  faGamepad, faChess, faPuzzlePiece, faDice, faGhost, faRobot,
  faTrophy, faMedal, faDumbbell, faFutbol, faPersonRunning,
  // 图片创作
  faPalette, faCamera, faCameraRetro, faImage, faImages,
  // 出行自然
  faPlane, faCar, faBicycle, faRocket, faLocationDot, faCompass, faGlobe, faMap,
  faMountain, faTree, faLeaf, faSun, faMoon, faCloud, faSnowflake, faFire,
  faBolt, faUmbrella,
  // 动物
  faPaw, faCat, faDog, faFish,
  // 美食
  faMugHot, faMugSaucer, faUtensils, faPizzaSlice, faBurger, faAppleWhole,
  faCakeCandles, faWineGlass, faBeerMugEmpty,
  // 生活
  faHouse, faCouch, faBed, faShirt, faGift, faCartShopping, faBriefcase,
  faGraduationCap, faBaby, faChild, faPerson,
  // 物件
  faLaptop, faMobileScreen, faKeyboard, faHeadset, faNoteSticky, faEnvelope,
  faComment, faBell, faCalendar, faClock, faBinoculars, faGlasses, faLightbulb,
  faMagnet, faKey, faShieldHalved,
  // 标记
  faStar, faHeart, faBookmark, faFlag, faTag, faFolder, faBox, faCrown, faGem,
  faWandSparkles, faHatWizard, faMask, faFaceSmile, faThumbsUp
]

// 手机端存储格式：FontAwesome codePoint 的十进制字符串
export function iconValue(d: IconDefinition): string {
  return String(parseInt(d.icon[3], 16))
}

const byCodePoint = new Map<string, IconDefinition>()
for (const d of CUSTOM_MODULE_ICONS) byCodePoint.set(iconValue(d), d)

export type ResolvedModuleIcon =
  | { kind: 'fa'; def: IconDefinition }
  | { kind: 'text'; text: string }
  | { kind: 'none' }

// 解析存储的 icon 字段：纯数字=FontAwesome codePoint；非空=旧版 emoji 文本；空=默认
export function resolveModuleIcon(icon: string | null | undefined): ResolvedModuleIcon {
  const v = (icon ?? '').trim()
  if (!v) return { kind: 'none' }
  const def = byCodePoint.get(v)
  if (def) return { kind: 'fa', def }
  return { kind: 'text', text: v }
}
