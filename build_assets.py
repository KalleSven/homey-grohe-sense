#!/usr/bin/env python3
import os
from PIL import Image

def process_driver_image(src_path, dest_large, dest_small):
    img = Image.open(src_path).convert("RGB")
    
    # Create white 500x500 canvas
    canvas_large = Image.new("RGB", (500, 500), (255, 255, 255))
    
    # Calculate aspect-ratio preserving fit with margin (max 440x440)
    target_max = 440
    w, h = img.size
    ratio = min(target_max / w, target_max / h)
    new_w = int(w * ratio)
    new_h = int(h * ratio)
    
    resized = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    
    # Paste centered
    pos_x = (500 - new_w) // 2
    pos_y = (500 - new_h) // 2
    canvas_large.paste(resized, (pos_x, pos_y))
    
    # Save large (500x500)
    canvas_large.save(dest_large, "PNG")
    
    # Resize and save small (75x75)
    canvas_small = canvas_large.resize((75, 75), Image.Resampling.LANCZOS)
    canvas_small.save(dest_small, "PNG")
    print(f"Generated {dest_large} (500x500) and {dest_small} (75x75)")

if __name__ == "__main__":
    sense_src = "/Users/johan/Downloads/22505LN1.jpeg"
    guard_src = "/Users/johan/Downloads/vattenfelsbrytare-grohe-sense-guard-22500 (2).jpeg"
    
    process_driver_image(sense_src,
                         "drivers/grohe_sense/assets/images/large.png",
                         "drivers/grohe_sense/assets/images/small.png")
                         
    process_driver_image(guard_src,
                         "drivers/grohe_sense_guard/assets/images/large.png",
                         "drivers/grohe_sense_guard/assets/images/small.png")

