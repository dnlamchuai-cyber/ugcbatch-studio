import type { NamespaceMessages } from "../config";

export const auth: NamespaceMessages = {
  en: {
    signInTitle: "Sign in to UGCBatch Studio",
    signUpTitle: "Create your account",
    email: "Email",
    password: "Password (min 6 characters)",
    signIn: "Sign in",
    signUp: "Sign up",
    noAccount: "No account yet? Sign up",
    haveAccount: "Already have an account? Sign in",
    mockNotice: "Local mock mode: no Supabase configured. Any email + password creates a local session on this device.",
    signOut: "Sign out",
  },
  vi: {
    signInTitle: "Đăng nhập UGCBatch Studio",
    signUpTitle: "Tạo tài khoản",
    email: "Email",
    password: "Mật khẩu (tối thiểu 6 ký tự)",
    signIn: "Đăng nhập",
    signUp: "Đăng ký",
    noAccount: "Chưa có tài khoản? Đăng ký",
    haveAccount: "Đã có tài khoản? Đăng nhập",
    mockNotice: "Chế độ giả lập cục bộ: chưa cấu hình Supabase. Email + mật khẩu bất kỳ sẽ tạo phiên đăng nhập trên máy này.",
    signOut: "Đăng xuất",
  },
};
