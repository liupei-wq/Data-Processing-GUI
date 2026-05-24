import os

def read_xrd_files():
    possible_paths = [
        r"C:\Users\peili\Desktop\XRD-繪圖",
        r"C:\Users\peili\Desktop\XRD_Program",
        r"..\XRD-繪圖",
        r"..\..\XRD-繪圖"
    ]
    
    found = False
    for path in possible_paths:
        if os.path.exists(path):
            print(f"找到資料夾: {path}")
            for root, dirs, files in os.walk(path):
                for file in files:
                    if file.endswith('.py') or file.endswith('.txt'):
                        file_path = os.path.join(root, file)
                        print(f"\n=================== {file} ===================")
                        try:
                            with open(file_path, 'r', encoding='utf-8') as f:
                                print(f.read())
                        except Exception as e:
                            try:
                                with open(file_path, 'r', encoding='gbk') as f:
                                    print(f.read())
                            except Exception as e2:
                                print(f"讀取失敗: {e2}")
            found = True
            break
            
    if not found:
        print("未找到桌面版的 XRD-繪圖 資料夾。請確認路徑是否存在。")

if __name__ == '__main__':
    read_xrd_files()
