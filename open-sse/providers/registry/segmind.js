export default {
  id: "segmind",
  priority: 80,
  alias: "segmind",
  aliases: [
    "segmind-ai",
  ],
  uiAlias: "segmind",
  display: {
    name: "Segmind",
    icon: "image",
    color: "#7C3AED",
    textIcon: "SG",
    website: "https://www.segmind.com",
    notice: {
      apiKeyUrl: "https://www.segmind.com",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: null,
  models: [
    { id: "flux-schnell", name: "FLUX.1 Schnell", params: ["size"], kind: "image" },
    { id: "flux-dev", name: "FLUX.1 Dev", params: ["size"], kind: "image" },
    { id: "flux-1.1-pro", name: "FLUX 1.1 Pro", params: ["size"], kind: "image" },
    { id: "sdxl1.0-txt2img", name: "Stable Diffusion XL 1.0", params: ["size"], kind: "image" },
    { id: "sd3.5-large-txt2img", name: "Stable Diffusion 3.5 Large", params: ["size"], kind: "image" },
    { id: "kandinsky2.2-txt2img", name: "Kandinsky 2.2", params: ["size"], kind: "image" },
  ],
  serviceKinds: ["image"],
  imageConfig: { baseUrl: "https://api.segmind.com/v1" },
};
