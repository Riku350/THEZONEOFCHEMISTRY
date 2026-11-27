import {
  BannerItem,
  BatchItem,
  CourseItem,
  GalleryItem,
  InstituteSettings,
  NoticeItem,
  StudentClass,
  StudentStream,
} from '../types';

export const ASSETS = {
  heroLab: '/src/assets/images/hero_chemistry_lab_1795759428730.jpg',
  sonuSirPortrait: '/src/assets/images/sonu_sir_portrait_1795759432019.jpg',
  admissionsBanner: '/src/assets/images/banner_neet_jee_admissions_1795759431844.jpg',
  galleryExperiment: '/src/assets/images/gallery_chemistry_experiment_1795759432230.jpg',
  galleryClassroom: '/src/assets/images/gallery_classroom_lecture_1795759432801.jpg',
} as const;

export const CLASS_OPTIONS: StudentClass[] = ['Class 10', 'Class 11', 'Class 12', 'Other'];
export const STREAM_OPTIONS: StudentStream[] = ['Science', 'PCM', 'PCB', 'Other'];

export const DEFAULT_ID_CARD_MOTIVATIONAL_MESSAGE = `Success is not achieved in one day. It is built through daily hard work, discipline and dedication.

Believe in yourself, stay focused on your goals, and never stop learning.

Your future is in your hands!`;

export const DEFAULT_SETTINGS: InstituteSettings = {
  id: 'main',
  instituteName: 'THE ZONE OF CHEMISTRY',
  teacherName: 'SONU SIR #BABA',
  tagline: 'Learn Chemistry – Build Your Future.',
  academicSession: '2026–2027',
  defaultFee: 5500,
  admissionsOpen: true,
  admissionHeadline: 'Admissions Open for Academic Session 2026–2027 — NEET, JEE & Board Batches',
  phone: '+91 98765 43210',
  whatsappNumber: '919876543210',
  email: 'admissions@thezoneofchemistry.in',
  address: 'Science Academic Complex, Main Coaching Road, Station Chowk, Bihar - 800001',
  signatureText: 'Sonu Sir #Baba',
  attendanceExitTracking: false,
  bannerSliderIntervalSec: 5,
  bannerAutoSlide: true,
  teacherPhotoUrl: '',
  teacherPhotoMediaId: '',
  teacherPhotoOriginalUrl: '',
  teacherPhotoOriginalMediaId: '',
  teacherPhotoIsCutout: false,
  teacherDesignation: 'Chemistry Teacher',
  teacherBio: '',
  teacherExperience: '',
  teacherSpecialization: '',
  teacherContactNumber: '',
  teacherWhatsappNumber: '',
  teacherEmail: '',
  idCardMotivationalMessage: DEFAULT_ID_CARD_MOTIVATIONAL_MESSAGE,
};

export const DEFAULT_COURSES: CourseItem[] = [
  {
    id: 'course-neet',
    title: 'NEET Preparation',
    category: 'Medical Entrance',
    targetClass: 'Class 11, 12 & Droppers',
    description:
      'Complete NCERT line-by-line mastery for Physical, Organic, and Inorganic Chemistry with daily mechanism drills and OMR mock tests.',
    duration: '12 Months',
    feeAmount: 7500,
    active: true,
    order: 1,
  },
  {
    id: 'course-jee',
    title: 'JEE Preparation',
    category: 'Engineering Entrance',
    targetClass: 'Class 11, 12 & Droppers',
    description:
      'Deep conceptual problem-solving in Thermodynamics, Kinetics, Coordination Compounds, and Multi-step Organic Synthesis for JEE Main & Advanced.',
    duration: '12 Months',
    feeAmount: 8000,
    active: true,
    order: 2,
  },
  {
    id: 'course-class-12',
    title: 'Class 12 Coaching',
    category: 'Board Excellence',
    targetClass: 'Class 12 (CBSE / State)',
    description:
      'Structured board syllabus coverage with weekly written tests, named reaction sheets, and full previous-year question bank practice.',
    duration: '10 Months',
    feeAmount: 5500,
    active: true,
    order: 3,
  },
  {
    id: 'course-class-11',
    title: 'Class 11 Coaching',
    category: 'Foundation Senior',
    targetClass: 'Class 11 (Science)',
    description:
      'Strong fundamentals in Mole Concept, Atomic Structure, Chemical Bonding, Equilibrium, and General Organic Chemistry (GOC).',
    duration: '10 Months',
    feeAmount: 5500,
    active: true,
    order: 4,
  },
  {
    id: 'course-class-10',
    title: 'Class 10 Coaching',
    category: 'Foundation',
    targetClass: 'Class 10 Board',
    description:
      'Crystal-clear understanding of Chemical Reactions, Acids & Bases, Metals, Carbon Compounds, and periodic trends for 95%+ board scores.',
    duration: '10 Months',
    feeAmount: 4500,
    active: true,
    order: 5,
  },
  {
    id: 'course-other',
    title: 'Other Courses',
    category: 'Crash & Special Batches',
    targetClass: 'Custom / Olympiad',
    description:
      'Intensive revision modules, Organic Chemistry mastery workshops, and competitive Olympiad preparation guided directly by Sonu Sir.',
    duration: '3–6 Months',
    feeAmount: 5500,
    active: true,
    order: 6,
  },
];

export const DEFAULT_BATCHES: BatchItem[] = [
  {
    id: 'batch-08-10',
    name: 'Morning Alpha Batch',
    timing: '8 AM – 10 AM',
    capacity: 60,
    feeOverride: null,
    active: true,
    order: 1,
  },
  {
    id: 'batch-10-12',
    name: 'Mid-Morning Scholar Batch',
    timing: '10 AM – 12 PM',
    capacity: 60,
    feeOverride: null,
    active: true,
    order: 2,
  },
  {
    id: 'batch-01-02',
    name: 'Afternoon Focus Batch',
    timing: '1 PM – 2 PM',
    capacity: 45,
    feeOverride: null,
    active: true,
    order: 3,
  },
  {
    id: 'batch-02-04',
    name: 'Afternoon Target Batch',
    timing: '2 PM – 4 PM',
    capacity: 60,
    feeOverride: null,
    active: true,
    order: 4,
  },
  {
    id: 'batch-04-06',
    name: 'Evening Achiever Batch',
    timing: '4 PM – 6 PM',
    capacity: 60,
    feeOverride: null,
    active: true,
    order: 5,
  },
];

export const DEFAULT_BANNERS: BannerItem[] = [
  {
    id: 'default-banner-1',
    title: 'NEET & JEE Chemistry Target Batches',
    subtitle: 'Session 2026–2027 · Guided by Sonu Sir #Baba',
    description:
      'Master Organic mechanisms, Physical numericals, and Inorganic trends with structured notes and personal doubt clearing.',
    announcement: 'Admissions Open — Standard Fee ₹5,500',
    ctaLabel: 'Apply for Admission',
    ctaTarget: 'apply',
    imageUrl: ASSETS.admissionsBanner,
    order: 1,
    active: true,
  },
  {
    id: 'default-banner-2',
    title: 'Concept Lab & Weekly OMR Test Series',
    subtitle: 'Class 10, 11, 12 Boards · Morning & Evening Slots',
    description:
      'Printed reaction roadmaps, weekly evaluations, and an official QR-verified Digital Student ID Card upon approval.',
    announcement: 'New Batches Starting Soon',
    ctaLabel: 'View Batch Timings',
    ctaTarget: '#batches',
    imageUrl: ASSETS.heroLab,
    order: 2,
    active: true,
  },
];

export const DEFAULT_GALLERY: GalleryItem[] = [
  {
    id: 'default-gal-1',
    title: 'Interactive Hybridization & Molecular Orbital Lecture',
    category: 'Classroom',
    imageUrl: ASSETS.galleryClassroom,
    active: true,
  },
  {
    id: 'default-gal-2',
    title: 'Precision Acid-Base Titration Demonstration',
    category: 'Laboratory',
    imageUrl: ASSETS.galleryExperiment,
    active: true,
  },
  {
    id: 'default-gal-3',
    title: 'NEET & JEE Morning Target Classroom Session',
    category: 'Classroom',
    imageUrl: ASSETS.admissionsBanner,
    active: true,
  },
  {
    id: 'default-gal-4',
    title: 'Modern Molecular Structure & Chemistry Studio',
    category: 'Institute',
    imageUrl: ASSETS.heroLab,
    active: true,
  },
];

export const DEFAULT_NOTICES: NoticeItem[] = [
  {
    id: 'default-notice-1',
    title: 'Online Admission Form Open for Session 2026–2027',
    content:
      'Students seeking admission to Class 10, Class 11, Class 12, NEET, and JEE Chemistry batches can submit their application online without creating an account. After admin verification, official Digital ID Cards will be issued.',
    category: 'Admission',
    pinned: true,
    active: true,
  },
  {
    id: 'default-notice-2',
    title: 'Weekly Organic Mechanism & NCERT Test Schedule',
    content:
      'Sunday cumulative chemistry tests are conducted for all Morning and Evening batches. Students must carry their QR-enabled Institute ID Card for attendance verification.',
    category: 'Exam',
    pinned: false,
    active: true,
  },
];

export const STUDENT_ACHIEVEMENTS = [
  {
    metric: '175 / 180',
    label: 'Highest NEET Chemistry Score',
    context: 'Session 2025–26 Classroom Program',
    student: 'Ananya Verma — AIIMS Patna Qualifier',
  },
  {
    metric: '99.4 %ile',
    label: 'JEE Main Chemistry Percentile',
    context: 'JEE Target Evening Batch',
    student: 'Rohan Kumar — NIT Trichy Admit',
  },
  {
    metric: '98 / 100',
    label: 'Class 12 Board Chemistry Top Score',
    context: 'CBSE & State Board Excellence',
    student: 'Priya Singh — District Science Topper',
  },
  {
    metric: '12+ Years',
    label: 'Dedicated Chemistry Mentorship',
    context: 'Guided personally by Sonu Sir #Baba',
    student: 'Organic · Inorganic · Physical Chemistry',
  },
];

export const STUDENT_TESTIMONIALS = [
  {
    name: 'Ananya Verma',
    role: 'NEET UG Qualifier — 175/180 in Chemistry',
    batch: 'NEET Target Batch (8 AM – 10 AM)',
    quote:
      'Before joining The Zone of Chemistry, Organic mechanisms felt like endless memorization. Sonu Sir broke every reaction down into electron-flow logic, and my mock test score jumped from 105 to 175 in six months.',
  },
  {
    name: 'Rohan Kumar',
    role: 'JEE Main 99.4 Percentile in Chemistry',
    batch: 'JEE Preparation Batch (4 PM – 6 PM)',
    quote:
      'Physical Chemistry numericals and Equilibrium used to cost me precious exam time. The daily practice sheets and personal doubt sessions with Sonu Sir #Baba turned Chemistry into my highest-scoring subject.',
  },
  {
    name: 'Priya Singh',
    role: 'Class 12 Board — 98% in Chemistry',
    batch: 'Class 12 Coaching (10 AM – 12 PM)',
    quote:
      'The structured NCERT notes, weekly written evaluations, and disciplined classroom environment gave me complete clarity before my board examinations.',
  },
];

export const INDIAN_STATES = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Delhi',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jammu and Kashmir',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
];
