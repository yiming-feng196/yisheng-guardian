# 本地视觉表情服务

本服务在本机内存中处理 Jetson Nano 前端上传的低分辨率 JPEG 帧，不保存原始画面或人脸截图。

- 人脸检测：OpenCV Zoo YuNet `face_detection_yunet_2023mar.onnx`
- 表情分类：OpenCV Zoo Progressive Teacher / MobileFaceNet
- 输出类别：生气、厌恶、紧张、愉悦、平静、低落、惊讶
- HTTP 接口：`POST /v1/analyze`，请求体为 JPEG/PNG 字节
- 健康检查：`GET /health`

表情结果只用于改善人机交互提示，不属于医疗诊断结果，不写入用户健康档案。

模型来自 OpenCV Zoo。YuNet 模型目录使用 MIT License，表情模型目录使用 Apache-2.0 License。
