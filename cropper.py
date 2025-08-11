#!/usr/bin/env python3

import sys
import os
from PIL import Image
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def detect_background_fast(img):
    width, height = img.size
    
    corners = [
        img.getpixel((0, 0)),
        img.getpixel((width-1, 0)),
        img.getpixel((0, height-1)),
        img.getpixel((width-1, height-1))
    ]
    
    from collections import Counter
    bg_color = Counter(corners).most_common(1)[0][0]
    
    print(f"FAST BG: {bg_color}")
    return bg_color

def fast_crop_bounds(img, bg_color, tolerance=35):
    width, height = img.size
    
    def color_diff(c1, c2):
        if len(c1) == 4:
            c1 = c1[:3]
        if len(c2) == 4:
            c2 = c2[:3]
        return sum(abs(a - b) for a, b in zip(c1, c2))
    
    left = 0
    for x in range(0, width, 5):
        for y in range(0, height, 20):
            if color_diff(img.getpixel((x, y)), bg_color) > tolerance:
                left = max(0, x - 2)
                break
        if left > 0:
            break
    
    right = width - 1
    for x in range(width-1, -1, -5):
        for y in range(0, height, 20):
            if color_diff(img.getpixel((x, y)), bg_color) > tolerance:
                right = min(width-1, x + 2)
                break
        if right < width - 1:
            break
    
    top = 0
    for y in range(0, height, 5):
        for x in range(0, width, 20):
            if color_diff(img.getpixel((x, y)), bg_color) > tolerance:
                top = max(0, y - 2)
                break
        if top > 0:
            break
    
    bottom = height - 1
    for y in range(height-1, -1, -5):
        for x in range(0, width, 20):
            if color_diff(img.getpixel((x, y)), bg_color) > tolerance:
                bottom = min(height-1, y + 2)
                break
        if bottom < height - 1:
            break
    
    return (left, top, right, bottom)

def center_object_with_padding(bounds, original_size, padding):
    left, top, right, bottom = bounds
    orig_width, orig_height = original_size
    
    obj_width = right - left
    obj_height = bottom - top
    
    print(f"OBJECT: {obj_width}x{obj_height} at ({left},{top})")
    
    new_width = obj_width + (padding * 2)
    new_height = obj_height + (padding * 2)
    
    obj_center_x = left + (obj_width // 2)
    obj_center_y = top + (obj_height // 2)
    
    crop_left = obj_center_x - (new_width // 2)
    crop_top = obj_center_y - (new_height // 2)
    crop_right = crop_left + new_width
    crop_bottom = crop_top + new_height
    
    crop_left = max(0, crop_left)
    crop_top = max(0, crop_top)
    crop_right = min(orig_width, crop_right)
    crop_bottom = min(orig_height, crop_bottom)
    
    if crop_right - crop_left < obj_width + padding:
        if crop_left == 0:
            crop_right = min(orig_width, crop_left + obj_width + padding * 2)
        elif crop_right == orig_width:
            crop_left = max(0, crop_right - obj_width - padding * 2)
    
    if crop_bottom - crop_top < obj_height + padding:
        if crop_top == 0:
            crop_bottom = min(orig_height, crop_top + obj_height + padding * 2)
        elif crop_bottom == orig_height:
            crop_top = max(0, crop_bottom - obj_height - padding * 2)
    
    final_box = (crop_left, crop_top, crop_right, crop_bottom)
    
    print(f"CENTERED CROP: {final_box} -> {crop_right-crop_left}x{crop_bottom-crop_top}")
    
    return final_box

def ultra_fast_crop(image_path, output_path, padding=40):
    try:
        print(f"=== ULTRA FAST CROP v3.1 - CENTERED ===")
        print(f"INPUT: {os.path.basename(image_path)}")
        
        img = Image.open(image_path)
        original_size = img.size
        print(f"SIZE: {original_size[0]}x{original_size[1]}")
        
        original_ext = os.path.splitext(image_path)[1].lower()
        print(f"FORMAT: {original_ext}")
        
        if img.mode not in ['RGB', 'RGBA']:
            print("MODE: Converting to RGB")
            img = img.convert('RGB')
        
        width, height = img.size
        
        if width < 200 or height < 200:
            print("SMALL IMAGE: Adding padding only")
            
            new_width = width + (padding * 2)
            new_height = height + (padding * 2)
            
            padded = Image.new('RGB', (new_width, new_height), (255, 255, 255))
            padded.paste(img, (padding, padding))
            
            padded.save(output_path, 'JPEG', quality=95, optimize=True)
            print(f"OUTPUT: {padded.size} saved as JPEG")
            print("STATUS: SUCCESS (PADDED)")
            return True
        
        if img.mode == 'RGBA':
            alpha = img.split()[-1]
            bbox = alpha.getbbox()
            
            if bbox and (bbox[2] - bbox[0] < width * 0.95):
                print("METHOD: Alpha crop with centering")
                
                centered_box = center_object_with_padding(bbox, (width, height), padding)
                cropped = img.crop(centered_box)
                
                if cropped.mode == 'RGBA':
                    rgb_img = Image.new('RGB', cropped.size, (255, 255, 255))
                    rgb_img.paste(cropped, mask=cropped.split()[-1])
                    cropped = rgb_img
                
                cropped.save(output_path, 'JPEG', quality=95, optimize=True)
                print(f"OUTPUT: {cropped.size} saved as JPEG")
                print("STATUS: SUCCESS (ALPHA CENTERED)")
                return True
        
        print("METHOD: Fast color crop with centering")
        bg_color = detect_background_fast(img)
        
        bounds = fast_crop_bounds(img, bg_color, tolerance=35)
        left, top, right, bottom = bounds
        
        print(f"BOUNDS: left={left}, top={top}, right={right}, bottom={bottom}")
        
        centered_box = center_object_with_padding(bounds, (width, height), padding)
        
        if centered_box[2] <= centered_box[0] or centered_box[3] <= centered_box[1]:
            print("INVALID CROP: Using original with padding")
            padded = Image.new('RGB', (width + padding*2, height + padding*2), (255, 255, 255))
            if img.mode == 'RGBA':
                padded.paste(img, (padding, padding), img)
            else:
                padded.paste(img, (padding, padding))
            cropped = padded
        else:
            cropped = img.crop(centered_box)
        
        if cropped.mode == 'RGBA':
            rgb_img = Image.new('RGB', cropped.size, (255, 255, 255))
            rgb_img.paste(cropped, mask=cropped.split()[-1])
            cropped = rgb_img
        
        cropped.save(output_path, 'JPEG', quality=95, optimize=True)
        
        print(f"OUTPUT: {cropped.size} saved as JPEG")
        print("STATUS: SUCCESS (CENTERED)")
        
        return True
        
    except Exception as e:
        print(f"ERROR: {str(e)}")
        try:
            print("FALLBACK: Simple padding")
            img = Image.open(image_path)
            
            if img.mode == 'RGBA':
                img = img.convert('RGB')
            
            width, height = img.size
            padded = Image.new('RGB', (width + padding*2, height + padding*2), (255, 255, 255))
            padded.paste(img, (padding, padding))
            
            padded.save(output_path, 'JPEG', quality=90)
            print("FALLBACK: Success")
            return True
            
        except Exception as e2:
            print(f"FALLBACK ERROR: {str(e2)}")
            return False

def main():
    if len(sys.argv) < 3:
        print("Usage: python cropper.py <input> <o> [padding]")
        sys.exit(1)
    
    input_path = sys.argv[1]
    output_path = sys.argv[2]
    padding = int(sys.argv[3]) if len(sys.argv) > 3 else 40
    padding = max(5, min(padding, 100))
    
    if not os.path.exists(input_path):
        print(f"ERROR: Input file not found: {input_path}")
        sys.exit(1)
    
    output_dir = os.path.dirname(output_path)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir)
    
    success = ultra_fast_crop(input_path, output_path, padding)
    
    if success:
        print("=== COMPLETED ===")
        sys.exit(0)
    else:
        print("=== FAILED ===")
        sys.exit(1)

if __name__ == "__main__":
    main()