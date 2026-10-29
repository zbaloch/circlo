import {
  ArrowLeft,
  ArrowUp,
  Ban,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleDot,
  Clock,
  Ellipsis,
  ExternalLink,
  Eye,
  Flag,
  FlaskConical,
  Globe,
  Heart,
  Hourglass,
  House,
  Image,
  Images,
  Key,
  Layers,
  Lock,
  LogOut,
  Bell,
  Mail,
  MessageCircle,
  Pencil,
  Play,
  Plus,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Smartphone,
  Square,
  SquareCheck,
  Star,
  Trash2,
  TriangleAlert,
  User,
  UserMinus,
  Users,
  Video,
  X,
  type LucideIcon,
} from 'lucide-react-native';

/**
 * The app's icons: Lucide (https://lucide.dev), drawn with react-native-svg. Names are kept from the earlier icon set
 * so screens read the same. Lucide is outline-only, so "filled" variants are shown either filled in (a liked heart,
 * the Close Friends star, play) or with a bolder stroke (the selected tab, a checked item).
 */
type Spec = { icon: LucideIcon; fill?: boolean; bold?: boolean };

const ICONS = {
  add: { icon: Plus },
  'arrow-back': { icon: ArrowLeft },
  'arrow-up': { icon: ArrowUp },
  'ban-outline': { icon: Ban },
  'camera-outline': { icon: Camera },
  'chatbubble-outline': { icon: MessageCircle },
  checkmark: { icon: Check },
  'checkmark-circle': { icon: CircleCheck, bold: true },
  'chevron-back': { icon: ChevronLeft },
  'chevron-down': { icon: ChevronDown },
  'chevron-forward': { icon: ChevronRight },
  close: { icon: X },
  'ellipse-outline': { icon: Circle },
  'ellipsis-horizontal': { icon: Ellipsis },
  'flag-outline': { icon: Flag },
  'open-outline': { icon: ExternalLink },
  'eye-outline': { icon: Eye },
  'flask-outline': { icon: FlaskConical },
  'globe-outline': { icon: Globe },
  heart: { icon: Heart, fill: true },
  'heart-outline': { icon: Heart },
  home: { icon: House, bold: true },
  'home-outline': { icon: House },
  'hourglass-outline': { icon: Hourglass },
  image: { icon: Image },
  'image-outline': { icon: Image },
  images: { icon: Images },
  'key-outline': { icon: Key },
  'layers-outline': { icon: Layers },
  'lock-closed': { icon: Lock },
  'lock-closed-outline': { icon: Lock },
  'log-out-outline': { icon: LogOut },
  mail: { icon: Mail, bold: true },
  'mail-outline': { icon: Mail },
  'pencil-outline': { icon: Pencil },
  notifications: { icon: Bell, bold: true },
  'notifications-outline': { icon: Bell },
  people: { icon: Users, bold: true },
  'people-outline': { icon: Users },
  'person-outline': { icon: User },
  'person-remove-outline': { icon: UserMinus },
  'phone-portrait-outline': { icon: Smartphone },
  play: { icon: Play, fill: true },
  'radio-button-on-outline': { icon: CircleDot },
  search: { icon: Search },
  'settings-outline': { icon: Settings },
  'shield-checkmark': { icon: ShieldCheck, bold: true },
  'shield-checkmark-outline': { icon: ShieldCheck },
  'shield-outline': { icon: Shield },
  'square-outline': { icon: Square },
  'checkbox': { icon: SquareCheck, bold: true },
  star: { icon: Star, fill: true },
  'time-outline': { icon: Clock },
  'trash-outline': { icon: Trash2 },
  videocam: { icon: Video },
  warning: { icon: TriangleAlert, bold: true },
  'warning-outline': { icon: TriangleAlert },
} satisfies Record<string, Spec>;

export type IconName = keyof typeof ICONS;

type Props = { name: IconName; size?: number; color?: string; accessibilityLabel?: string };

export function Icon({ name, size = 24, color, accessibilityLabel }: Props) {
  const spec: Spec = ICONS[name];
  const Glyph = spec.icon;
  return (
    <Glyph
      size={size}
      color={color}
      fill={spec.fill ? color : 'none'}
      strokeWidth={spec.bold ? 2.5 : 1.75}
      accessible={!!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
    />
  );
}
